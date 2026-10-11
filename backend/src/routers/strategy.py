"""Stock screening API — manual common strategies + AI dynamic condition screening."""
from __future__ import annotations

import json
import logging

import twstock
from arango.database import StandardDatabase
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.db import get_db
from src.indicator_rag import format_evidence, get_rag
from src.llm import chat_completion, chat_completion_with_fallback, extract_json_object
from src.strategy import ALLOWED_OPS, CATALOG_TEXT, INDICATOR_CATALOG, evaluate_stock
from src.strategy_script import ScriptError, parse_script, render_script

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/strategy", tags=["strategy"])

SYSTEM_PROMPT = f"""你是台股技術面選股條件生成器。使用者會用自然語言描述想找的股票，
請先用自己的專業知識理解需求（例如動能、趨勢、超買超賣、量價關係等），
然後從下方「可用指標目錄」中挑選指標，動態組合成可執行的篩選條件公式。
只輸出 JSON，不要輸出其他文字。

## 可用指標目錄（未指定 tf 時指標皆為「最新一根日K」的數值）
{CATALOG_TEXT}

## 條件語法
每個條件是一個物件：
{{"metric": "指標名稱", "op": "運算子", "value": "數值或另一指標", "note": "給使用者看的繁中說明"}}

可選欄位 "tf" 指定時間框架：省略＝日K（預設），"w"＝週K，"15m"＝15分K。
只有使用者明確要求週K/15分K等多時間框架條件時才輸出 "tf"，否則一律省略；同一條件的指標比較只會在同時間框架內進行。

運算子（op）：
- ">", ">=", "<", "<=", "=="：數值比較。value 可以是數字，也可以是另一指標名稱（例如 ma8 > ma21）
- "cross_above"：向上穿越（前一根 <= value，最新一根 > value），如 MACD 金叉
- "cross_below"：向下穿越（前一根 >= value，最新一根 < value），如 MACD 死叉
- "is_true"：布林指標為真（僅適用布林型指標，如 ma_bull、buy_signal）

布林型指標（ma_bull、buy_signal、sell_signal）只能用 "is_true"，不能用數值比較。

## 輸出格式
{{"conditions": [條件物件...], "limit": 50, "explanation": "一句繁中說明你如何理解需求與選擇的條件"}}

## 原則
1. 條件數 1~5 個，描述明確提到的才納入；若描述太模糊，選 2~3 個最合理的技術條件。
2. 每個條件的 note 用繁體中文、簡短（例如「RSI大於60」「MA8突破MA21」「量比大於1.5」）。
3. limit 為回傳筆數（1~200），使用者沒提就 50。
4. 不要輸出目錄外的指標；不要輸出目錄外的運算子。"""


class AiScreenRequest(BaseModel):
    description: str = Field(min_length=2, max_length=500, description="自然語言選股描述")
    limit: int = Field(default=50, ge=1, le=200)
    scope: str = Field(default="all", description="掃描範圍: all / watchlist / sector:<industry>")
    llm: dict = Field(description="LLM 連線設定（base_url/model/api_key/temperature/max_tokens/fallback）")
    conditions: list[dict] | None = Field(default=None, description="已生成的條件公式；提供時跳過 LLM 直接掃描（兩階段確認流程第二階段用）")


class ScreenPostRequest(BaseModel):
    preset_id: str | None = Field(default=None, description="預設策略 id（與 conditions 二選一）")
    conditions: list[dict] | None = Field(default=None, description="自訂條件公式；提供時直接驗證掃描")
    limit: int = Field(default=50, ge=1, le=5000)
    scope: str = Field(default="all", description="掃描範圍: all / watchlist / sector:<industry>")


class IndicatorSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200, description="自然語言或指標名查詢")
    top_k: int = Field(default=5, ge=1, le=20, description="回傳最多幾筆（不含 combines_with 連帶拉取）")


def build_system_prompt(rag_evidence: str | None = None) -> str:
    """組裝 AI 選股 SYSTEM_PROMPT；提供 rag_evidence 時在指標目錄後注入知識庫依據。"""
    if not rag_evidence:
        return SYSTEM_PROMPT
    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"## 知識庫依據（檢索結果，供你推斷）\n"
        f"{rag_evidence}"
    )


def _search_rag_evidence(description: str) -> tuple[str | None, list[dict]]:
    """檢索指標知識庫，回傳 (evidence 字串, 前 5 個 metric/name/score 清單)。

    RAG 整個掛掉時退回 None/[]，不影響主流程。
    """
    try:
        result = get_rag().search(description)
    except Exception:  # noqa: BLE001 — RAG 失敗不應影響選股主流程
        logger.exception("indicatorRAG search failed — proceeding without evidence")
        return None, []
    results = result.get("results") or []
    if not results:
        return None, []
    evidence = format_evidence(results)
    top_evidence = [
        {"metric": r["metric"], "name": r["name"], "score": r.get("score", 0)}
        for r in results[:5]
    ]
    return evidence, top_evidence


SUGGEST_SYSTEM_PROMPT = """你是台股選股建議助手。使用者會用自然語言描述想找的股票，
例如「大約是 2317 相當的股票」。請從提供的候選股票清單中，選出最符合描述的交集名單，
並對每檔給一句簡短理由。只輸出 JSON，不要輸出其他文字。

輸出格式：
{"suggestions": [{"stock_id": "2330", "name": "台積電", "reason": "與 2317 同屬權值半導體龍頭"}]}

原則：
1. 只能從候選股票清單中挑選，stock_id 必須存在於清單內。
2. 建議 3~10 檔，依符合程度排序。
3. reason 用繁體中文，一句話以內。"""


class TestConnectionRequest(BaseModel):
    llm: dict = Field(description="LLM 連線設定（base_url/model/api_key/temperature/max_tokens/fallback）")


class AiSuggestRequest(BaseModel):
    description: str = Field(min_length=2, max_length=500, description="自然語言股票描述")
    universe: list[dict] = Field(description="候選股票清單（stock_id/name/tags/market）")
    llm: dict = Field(description="LLM 連線設定（base_url/model/api_key/temperature/max_tokens/fallback）")


PRESET_STRATEGIES = [
    {
        "id": "multi_tf_6g",
        "name": "多時框 6 組條件（13 條）",
        "description": "週K 均線多頭 + 日K 趨勢突破 + 15分K 短線動能，13 條全通過才列出",
        "conditions": [
            {"metric": "ma8", "op": ">", "value": "ma21", "tf": "w", "note": "週K MA8>MA21"},
            {"metric": "ma21", "op": ">", "value": "ma55", "tf": "w", "note": "週K MA21>MA55"},
            {"metric": "slope55", "op": ">", "value": 0, "note": "日K MA55斜率>0"},
            {"metric": "price", "op": ">", "value": "ma55", "note": "收盤>MA55"},
            {"metric": "ma8", "op": ">", "value": "ma21", "tf": "15m", "note": "15分 MA8>MA21"},
            {"metric": "ma21", "op": ">", "value": "ma55", "tf": "15m", "note": "15分 MA21>MA55"},
            {"metric": "slope8", "op": ">", "value": 0, "tf": "15m", "note": "15分 MA8斜率>0"},
            {"metric": "slope21", "op": ">", "value": 0, "tf": "15m", "note": "15分 MA21斜率>0"},
            {"metric": "slope55", "op": ">", "value": 0, "tf": "15m", "note": "15分 MA55斜率>0"},
            {"metric": "price", "op": ">=", "value": "max_high_2d", "note": "收盤≥2日最高"},
            {"metric": "slope5", "op": ">", "value": 0, "note": "5日線斜率>0"},
            {"metric": "price", "op": ">=", "value": "ma8", "note": "收盤≥MA8"},
            {"metric": "slope8", "op": ">", "value": 0, "note": "8日線斜率>0"},
        ],
    },
]


def _validate_conditions(conditions: list[dict]) -> list[dict]:
    """Normalize and validate LLM-generated conditions; drop invalid ones."""
    from src.strategy import INDICATOR_CATALOG

    metric_types = {m["metric"]: m["type"] for m in INDICATOR_CATALOG}
    valid: list[dict] = []
    for cond in conditions:
        if not isinstance(cond, dict):
            continue
        metric = str(cond.get("metric", ""))
        op = str(cond.get("op", ""))
        if metric not in metric_types or op not in ALLOWED_OPS:
            continue
        mtype = metric_types[metric]
        if mtype == "bool":
            if op != "is_true":
                continue
            value = None
        else:
            if op == "is_true":
                continue
            value = cond.get("value")
            # value must be a number or a known numeric metric name
            if isinstance(value, (int, float)):
                pass
            elif isinstance(value, str) and value in metric_types and metric_types[value] == "num":
                pass
            else:
                continue
        tf = cond.get("tf")
        if tf not in (None, "d", "w", "15m", "D", "W", "15M"):
            tf = "d"
        if isinstance(tf, str):
            tf = tf.lower()
        c = {
            "metric": metric,
            "op": op,
            "value": value,
            "note": str(cond.get("note", ""))[:80] or metric,
        }
        if tf:
            c["tf"] = tf
        valid.append(c)
    return valid


def _resolve_scope(db: StandardDatabase, scope: str) -> dict[str, str]:
    """Resolve a scope selector to a stock_id → name whitelist map.

    - "all" → every stock in stock_codes (existing behavior)
    - "watchlist" → only stocks present in the watchlist collection
    - "sector:<industry>" → stock_codes filtered by industry (unknown → empty map)
    - anything else → HTTP 400
    """
    if scope == "all":
        cursor = db.aql.execute("FOR s IN stock_codes RETURN { stock_id: s.stock_id, name: s.name }")
    elif scope == "watchlist":
        cursor = db.aql.execute(
            """
            FOR w IN watchlist
              FOR s IN stock_codes
                FILTER s.stock_id == w.stock_id
                RETURN { stock_id: s.stock_id, name: s.name }
            """
        )
    elif scope.startswith("sector:"):
        industry = scope[len("sector:"):].strip()
        cursor = db.aql.execute(
            """
            FOR s IN stock_codes
              FILTER s.industry == @industry
              RETURN { stock_id: s.stock_id, name: s.name }
            """,
            bind_vars={"industry": industry},
        )
    else:
        raise HTTPException(status_code=400, detail=f"invalid scope: {scope}")
    return {str(row["stock_id"]): row.get("name") for row in cursor}


def _market_label(stock_id: str) -> str:
    """Map a stock_id to its 市場別 label (上市 / 上櫃 / 上市ETF / 上市TDR ...)."""
    info = twstock.codes.get(stock_id)
    if info is None:
        return ""
    if info.type == "ETF":
        return f"{info.market}ETF"
    if info.type == "股票":
        return info.market
    if "TDR" in info.type:
        return "上市TDR"
    return info.market


def _scan(
    conditions: list[dict],
    limit: int,
    stock_ids_map: dict[str, str] | None = None,
) -> tuple[list[dict], int]:
    """Scan the universe against the conditions, return (results, scanned).

    When `stock_ids_map` (a stock_id → name whitelist) is provided, only the
    whitelisted stocks are evaluated and `scanned` equals the whitelist size.
    """
    db = get_db()
    if stock_ids_map is None:
        codes = db.aql.execute("FOR s IN stock_codes RETURN { stock_id: s.stock_id, name: s.name }")
        name_map = {str(row["stock_id"]): row.get("name") for row in codes}
    else:
        name_map = stock_ids_map
    stock_ids = list(name_map.keys())

    results: list[dict] = []
    for sid in stock_ids:
        try:
            r = evaluate_stock(sid, conditions, name=name_map.get(sid))
        except Exception:
            continue  # missing data / fetch error — skip
        if r and r["passed"]:
            r["market"] = _market_label(sid)
            results.append(r)

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit], len(stock_ids)


def _manual_conditions(
    ma_bull: bool,
    ma_slope: bool,
    slope_min: float,
    kdj_golden: bool,
    kdj_max: float,
    rsi_mid: bool,
    rsi_min: float,
    rsi_max: float,
    macd_pos: bool,
    above_offset: bool,
    vol_expand: bool,
    vol_ratio: float,
    inst_active: bool,
) -> list[dict]:
    """Map the manual 7-boolean strategy switches onto the condition DSL so the
    manual screen shares the same evaluation engine (and shows actual values)."""
    conditions: list[dict] = []
    if ma_bull:
        conditions.append({"metric": "ma_bull", "op": "is_true", "value": None, "note": "MA8>MA21>MA55 多頭排列"})
    if ma_slope:
        conditions.append({"metric": "slope8", "op": ">", "value": slope_min, "note": f"MA8斜率>{slope_min:.2f}%"})
    if kdj_golden:
        conditions.append({"metric": "kdj_k", "op": ">", "value": "kdj_d", "note": "KDJ K>D"})
        conditions.append({"metric": "kdj_k", "op": "<", "value": kdj_max, "note": f"KDJ K<{kdj_max:.0f}"})
    if rsi_mid:
        conditions.append({"metric": "rsi", "op": ">", "value": rsi_min, "note": f"RSI>{rsi_min:.0f}"})
        conditions.append({"metric": "rsi", "op": "<", "value": rsi_max, "note": f"RSI<{rsi_max:.0f}"})
    if macd_pos:
        conditions.append({"metric": "macd_hist", "op": ">", "value": 0, "note": "MACD柱>0"})
    if above_offset:
        conditions.append({"metric": "price", "op": ">", "value": "close_offset", "note": "收盤>扣抵值"})
    if vol_expand:
        conditions.append({"metric": "vol_ratio", "op": ">", "value": vol_ratio, "note": f"量比>{vol_ratio:.1f}"})
    if inst_active:
        conditions.append({"metric": "inst_active", "op": "is_true", "value": None, "note": "近15日三大法人有交易"})
    return conditions


@router.get("/presets")
def list_presets() -> dict:
    """Return the built-in preset strategies (id / name / description / conditions)."""
    return {"presets": PRESET_STRATEGIES}


@router.post("/screen")
def screen_post(req: ScreenPostRequest) -> dict:
    """Run a preset strategy (preset_id) or custom conditions against the universe."""
    if req.preset_id:
        preset = next((p for p in PRESET_STRATEGIES if p["id"] == req.preset_id), None)
        if preset is None:
            raise HTTPException(status_code=404, detail=f"未知策略 id: {req.preset_id}")
        conditions = _validate_conditions(preset["conditions"])
    elif req.conditions:
        conditions = _validate_conditions(req.conditions)
    else:
        raise HTTPException(status_code=422, detail="請提供 preset_id 或 conditions")
    if not conditions:
        raise HTTPException(status_code=422, detail="無有效條件")
    results, scanned = _scan(conditions, req.limit, _resolve_scope(get_db(), req.scope))
    return {
        "total": len(results),
        "scanned": scanned,
        "results": results,
        "conditions": conditions,
        "scope": req.scope,
    }


@router.get("/screen")
def screen(
    ma_bull: bool = Query(default=True, description="MA8>MA21>MA55 多頭排列"),
    ma_slope: bool = Query(default=False, description="MA8 斜率 > 門檻"),
    slope_min: float = Query(default=0.05, ge=0.0, le=10.0, description="MA8 斜率下限 %"),
    kdj_golden: bool = Query(default=False, description="KDJ 金叉且未超買"),
    kdj_max: float = Query(default=80.0, ge=0.0, le=100.0),
    rsi_mid: bool = Query(default=False, description="RSI 50~70 偏多未超買"),
    rsi_min: float = Query(default=50.0, ge=0.0, le=100.0),
    rsi_max: float = Query(default=70.0, ge=0.0, le=100.0),
    macd_pos: bool = Query(default=False, description="MACD 柱為正"),
    above_offset: bool = Query(default=False, description="收盤 > 扣抵值"),
    vol_expand: bool = Query(default=False, description="近5日均量 > 近20日 x 倍"),
    vol_ratio: float = Query(default=1.2, ge=1.0, le=5.0),
    inst_active: bool = Query(default=False, description="近15交易日三大法人有交易"),
    limit: int = Query(default=50, ge=1, le=5000, description="回傳最多幾檔（上限 5000）"),
    scope: str = Query(default="all", description="掃描範圍: all / watchlist / sector:<industry>"),
) -> dict:
    """Manual common-strategy screening. The 7 boolean switches are mapped onto
    the same condition DSL the AI flow uses, so results include actual values."""
    conditions = _manual_conditions(
        ma_bull, ma_slope, slope_min, kdj_golden, kdj_max,
        rsi_mid, rsi_min, rsi_max, macd_pos, above_offset, vol_expand, vol_ratio,
        inst_active,
    )
    results, scanned = _scan(conditions, limit, _resolve_scope(get_db(), scope))
    return {
        "total": len(results),
        "scanned": scanned,
        "results": results,
        "conditions": conditions,
        "scope": scope,
    }


@router.get("/industries")
def industries() -> dict:
    """Return the distinct industries present in stock_codes with their counts."""
    db = get_db()
    cursor = db.aql.execute(
        """
        FOR s IN stock_codes
          FILTER s.industry != null AND s.industry != ''
          COLLECT industry = s.industry WITH COUNT INTO cnt
          RETURN { industry: industry, count: cnt }
        """
    )
    items = sorted(list(cursor), key=lambda x: x["industry"])
    return {"total": len(items), "industries": items}


@router.post("/ai-suggest-stocks")
def ai_suggest_stocks(req: AiSuggestRequest) -> dict:
    """Natural-language stock suggestion: the LLM picks a matching subset from
    the caller-provided universe (e.g. the research universe)."""
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="請輸入股票描述")
    if not req.universe:
        raise HTTPException(status_code=422, detail="候選股票清單為空")

    llm = req.llm or {}
    try:
        reply, used = chat_completion_with_fallback(
            llm=llm,
            system_prompt=SUGGEST_SYSTEM_PROMPT,
            user_prompt=(
                f"使用者描述：{req.description}\n\n"
                f"候選股票清單（JSON）：\n{json.dumps(req.universe, ensure_ascii=False)}"
            ),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        parsed = extract_json_object(reply)
    except ValueError as exc:
        logger.error("LLM reply not parseable: %s", reply[:500])
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    known = {str(s["stock_id"]): s for s in req.universe}
    suggestions: list[dict] = []
    for item in parsed.get("suggestions", []):
        sid = str(item.get("stock_id", "")).strip()
        if sid not in known:
            continue
        suggestions.append(
            {
                "stock_id": sid,
                "name": known[sid].get("name") or str(item.get("name", "")),
                "reason": str(item.get("reason", "")),
            }
        )

    return {
        "description": req.description,
        "total": len(suggestions),
        "suggestions": suggestions,
        "used_fallback": used.get("fallback", False),
        "fallback_model": used.get("model") if used.get("fallback") else None,
    }


@router.post("/indicator-search")
def indicator_search(req: IndicatorSearchRequest) -> dict:
    """indicatorRAG 檢索：AI 選股前的「推斷依據」查詢。

    回傳語意最相關的指標知識庫文件（含 combines_with 連帶拉取），
    依 implemented 分成 executable_metrics / knowledge_only_metrics。
    """
    return get_rag().search(req.query, top_k=req.top_k)


@router.post("/ai-screen/translate")
def ai_screen_translate(req: AiScreenRequest) -> dict:
    """Stage 1 of the two-phase AI screen: the LLM understands the description
    and dynamically builds a condition formula WITHOUT scanning the universe.
    Returns the formula + explanation so the user can confirm before the scan."""
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="請輸入選股描述")

    llm = req.llm or {}
    rag_evidence, _ = _search_rag_evidence(req.description)
    try:
        reply, used = chat_completion_with_fallback(
            llm=llm,
            system_prompt=build_system_prompt(rag_evidence),
            user_prompt=f"選股描述：{req.description}\n回傳筆數上限：{req.limit}",
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        parsed = extract_json_object(reply)
    except ValueError as exc:
        logger.error("LLM reply not parseable: %s", reply[:500])
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    conditions = _validate_conditions(parsed.get("conditions", []))
    if not conditions:
        raise HTTPException(status_code=502, detail="LLM 未生成有效條件，請換句話描述")

    return {
        "description": req.description,
        "translated": {"conditions": conditions},
        "explanation": str(parsed.get("explanation", "")),
        "conditions": conditions,
        "used_fallback": used.get("fallback", False),
        "fallback_model": used.get("model") if used.get("fallback") else None,
    }


@router.post("/test-connection")
def test_connection(req: TestConnectionRequest) -> dict:
    """Validate the current LLM connection settings by sending a minimal
    chat-completion request. Used by the 系統設定 UI so users can verify
    base_url/model/api_key before running an AI screen. Returns ok + a short
    summary, or a 502 with the upstream error message."""
    llm = req.llm or {}
    try:
        reply = chat_completion(
            base_url=str(llm.get("base_url", "")),
            model=str(llm.get("model", "")),
            api_key=str(llm.get("api_key", "")),
            temperature=0.0,
            max_tokens=16,
            system_prompt="你是連線測試助手。",
            user_prompt="請回覆：ok",
            timeout=30.0,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True, "model": llm.get("model"), "reply": (reply or "")[:60]}


@router.post("/ai-screen")
def ai_screen(req: AiScreenRequest) -> dict:
    """Natural-language stock screening. Two modes:
    - `conditions` provided (two-phase flow stage 2): scan with the confirmed
      formula directly, skipping the LLM call.
    - otherwise (one-shot flow): LLM builds the condition formula, then the
      engine scans the universe.
    """
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="請輸入選股描述")

    rag_evidence, rag_evidence_list = _search_rag_evidence(req.description)

    if req.conditions:
        conditions = _validate_conditions(req.conditions)
        used = {"fallback": False}
    else:
        llm = req.llm or {}
        try:
            reply, used = chat_completion_with_fallback(
                llm=llm,
                system_prompt=build_system_prompt(rag_evidence),
                user_prompt=f"選股描述：{req.description}\n回傳筆數上限：{req.limit}",
            )
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        try:
            parsed = extract_json_object(reply)
        except ValueError as exc:
            logger.error("LLM reply not parseable: %s", reply[:500])
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        conditions = _validate_conditions(parsed.get("conditions", []))

    if not conditions:
        raise HTTPException(status_code=502, detail="LLM 未生成有效條件，請換句話描述")

    results, scanned = _scan(conditions, req.limit, _resolve_scope(get_db(), req.scope))

    return {
        "description": req.description,
        "translated": {"conditions": conditions},
        "total": len(results),
        "scanned": scanned,
        "results": results,
        "conditions": conditions,
        "scope": req.scope,
        "rag": {"evidence": rag_evidence_list},
        "used_fallback": used.get("fallback", False),
        "fallback_model": used.get("model") if used.get("fallback") else None,
    }


class ScriptParseRequest(BaseModel):
    script: str = Field(min_length=1, max_length=4000, description="受限語言策略腳本")


class ScriptRunRequest(BaseModel):
    script: str = Field(min_length=1, max_length=4000, description="受限語言策略腳本")
    limit: int = Field(default=50, ge=1, le=5000)
    scope: str = Field(default="all", description="掃描範圍: all / watchlist / sector:<industry>")


def _script_to_conditions(script: str) -> list[dict]:
    try:
        raw = parse_script(script)
    except ScriptError as exc:
        raise HTTPException(status_code=422, detail=f"腳本解析失敗：{exc}") from exc
    conditions = _validate_conditions(raw)
    if not conditions:
        raise HTTPException(status_code=422, detail="腳本沒有有效條件（請確認指標都在目錄內）")
    return conditions


@router.post("/parse-script")
def parse_script_endpoint(req: ScriptParseRequest) -> dict:
    conditions = _script_to_conditions(req.script)
    return {"conditions": conditions, "script": render_script(conditions)}


@router.post("/run-script")
def run_script(req: ScriptRunRequest) -> dict:
    conditions = _script_to_conditions(req.script)
    matched, scanned = _scan(conditions, 5000, _resolve_scope(get_db(), req.scope))
    return {
        "total": len(matched),
        "scanned": scanned,
        "results": matched[: req.limit],
        "conditions": conditions,
        "scope": req.scope,
    }


SCRIPT_SYSTEM_PROMPT = f"""你是台股選股策略腳本生成器。使用者會用自然語言描述想找的股票，
請轉成一段「策略腳本」。只輸出 JSON，不要輸出其他文字。

## 可用指標目錄（未指定 tf 時為日K）
{CATALOG_TEXT}

## 腳本語法（受限語言）
- 每行一個敘述；`名稱 = 運算式` 指派布林群組；最後以 `buy = 運算式` 作為訊號。
- 運算元：目錄內的指標名稱、或數字。
- 比較運算子：> >= < <= ==。數值指標必須搭配運算子（如 rsi > 60）；布林指標單獨使用（如 inst_active）。
- 邏輯連接：只用 `and`（或 `&`）。**不支援 or / not**（掃描引擎為 AND）。
- 時間框架：預設日K；`weekly(比較)`＝週K、`m15(比較)`＝15分K。
- 可加 `#` 註解。

## 範例
trend = (ma8 > ma21) and (ma21 > ma55)
momentum = rsi > 60
chips = inst_active
buy = trend and momentum and chips

## 輸出格式
{{"script": "腳本文字", "explanation": "一句繁中說明你如何理解需求"}}

## 原則
1. 只用目錄內指標；條件 1~5 個；描述模糊時選 2~3 個合理技術條件。
2. 不要使用 or / not。"""


class GenerateScriptRequest(BaseModel):
    description: str = Field(min_length=2, max_length=500)
    llm: dict = Field(description="LLM 連線設定")


@router.post("/generate-script")
def generate_script(req: GenerateScriptRequest) -> dict:
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="請輸入策略描述")
    llm = req.llm or {}
    try:
        reply, used = chat_completion_with_fallback(
            llm=llm,
            system_prompt=SCRIPT_SYSTEM_PROMPT,
            user_prompt=f"選股描述：{req.description}",
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
        parsed = extract_json_object(reply)
    except ValueError as exc:
        logger.error("generate-script reply not parseable: %s", reply[:500])
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    explanation = str(parsed.get("explanation", ""))
    conditions: list[dict] = []
    script_text = str(parsed.get("script", "")).strip()
    if script_text:
        try:
            conditions = _validate_conditions(parse_script(script_text))
        except ScriptError:
            conditions = []

    if not conditions:
        try:
            reply2, _ = chat_completion_with_fallback(
                llm=llm,
                system_prompt=build_system_prompt(None),
                user_prompt=f"選股描述：{req.description}\n回傳筆數上限：50",
            )
            parsed2 = extract_json_object(reply2)
            conditions = _validate_conditions(parsed2.get("conditions", []))
            if not explanation:
                explanation = str(parsed2.get("explanation", ""))
        except (ValueError, RuntimeError):
            conditions = []

    if not conditions:
        raise HTTPException(status_code=502, detail="AI 未生成有效策略，請換句話描述")

    return {
        "description": req.description,
        "script": render_script(conditions),
        "conditions": conditions,
        "explanation": explanation,
        "used_fallback": used.get("fallback", False),
        "fallback_model": used.get("model") if used.get("fallback") else None,
    }


@router.get("/indicators")
def list_indicators() -> dict:
    return {"ops": list(ALLOWED_OPS), "indicators": INDICATOR_CATALOG}


EXPLAIN_SYSTEM_PROMPT = """你是台股量化策略解說員。使用者提供一組「選股條件」與其原始描述，
請產出精簡的繁體中文 Markdown 說明，只輸出 Markdown，不要有其他文字。內容包含：
1. **策略意涵**：這些條件合起來在找什麼樣的股票（1~2 句）。
2. **功能 → 條件對照**：逐條說明每個條件代表什麼。
3. 一張 **Mermaid 決策流程圖**：用 ```mermaid 區塊、`flowchart TD`，把各條件匯流到 `buy` 訊號。
範例：
```mermaid
flowchart TD
  A[趨勢: MA8>MA21] --> D((buy))
  B[動能: RSI>60] --> D
  C[籌碼: 法人買超] --> D
```"""


class ExplainRequest(BaseModel):
    description: str = Field(default="", max_length=500)
    conditions: list[dict] = Field(default_factory=list)
    llm: dict = Field(description="LLM 連線設定")


@router.post("/explain")
def explain_strategy(req: ExplainRequest) -> dict:
    if not req.conditions:
        raise HTTPException(status_code=422, detail="沒有條件可解釋")
    llm = req.llm or {}
    cond_lines = "\n".join(
        f"- {c.get('note') or c.get('metric')}（metric={c.get('metric')}, "
        f"op={c.get('op')}, value={c.get('value')}"
        + (f", tf={c.get('tf')}" if c.get("tf") else "")
        + "）"
        for c in req.conditions
    )
    user_prompt = f"使用者描述：{req.description or '（無）'}\n\n選股條件：\n{cond_lines}"
    try:
        reply, used = chat_completion_with_fallback(
            llm=llm, system_prompt=EXPLAIN_SYSTEM_PROMPT, user_prompt=user_prompt
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"markdown": reply, "used_fallback": used.get("fallback", False)}
