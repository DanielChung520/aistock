"""Search-pattern CRUD API.

Each pattern stores a user-selected bar pattern (close series selected on a
chart) plus its comparison parameters. Patterns live in the ArangoDB
`search_patterns` collection and are used by the shape-search endpoint to
scan the universe for stocks whose recent走势 looks similar.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from src.db import get_db
from src.pattern_search import search_universe

router = APIRouter(prefix="/patterns", tags=["patterns"])


class PatternParams(BaseModel):
    window: int = Field(default=20, ge=5, le=200, description="比對最近 N 根")
    normalize: str = Field(default="zscore", pattern="^(zscore|pct)$")
    metric: str = Field(default="euclidean", pattern="^(euclidean|dtw)$")
    trend_filter: str = Field(default="none", pattern="^(none|up|down|range)$")
    threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    limit: int = Field(default=30, ge=1, le=200)
    end_date: str | None = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="ISO date 覆寫搜尋錨點；null = 用 pattern.end_date 或最新資料",
    )


class PatternCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    symbol: str = Field(min_length=1, max_length=10)
    bars: list[float] = Field(min_length=5, max_length=2000)
    end_date: str | None = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Pattern 最後日期（box-select 自動填入），用於時間對齊搜尋",
    )
    params: PatternParams = Field(default_factory=PatternParams)
    thumbnail: str | None = Field(default=None, max_length=2_000_000, description="PNG 縮圖（base64 data URL）")
    ai_description: str | None = Field(default=None, max_length=500, description="AI 對此圖形的理解描述（繁中）")
    ai_summary: bool = Field(default=False, description="是否由後端以 LLM 生成 ai_description")
    llm: dict = Field(default_factory=dict, description="LLM 連線設定（與 /search 端點相同）")


class PatternUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    symbol: str | None = Field(default=None, min_length=1, max_length=10)
    bars: list[float] | None = Field(default=None, min_length=5, max_length=2000)
    end_date: str | None = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="Pattern 最後日期",
    )
    params: PatternParams | None = None
    thumbnail: str | None = Field(default=None, max_length=2_000_000, description="PNG 縮圖（base64 data URL）")
    ai_description: str | None = Field(default=None, max_length=500, description="AI 對此圖形的理解描述（繁中）")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_pattern(db, key: str) -> dict:
    try:
        doc = db.collection("search_patterns").get(key)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="pattern not found")
    return doc


@router.get("")
def list_patterns() -> list[dict]:
    db = get_db()
    aql = """
    FOR p IN search_patterns
      SORT p.created_at DESC
      RETURN {
        _key: p._key,
        name: p.name,
        symbol: p.symbol,
        bars: p.bars,
        end_date: p.end_date,
        params: p.params,
        thumbnail: p.thumbnail,
        ai_description: p.ai_description,
        created_at: p.created_at,
        updated_at: p.updated_at
      }
    """
    cursor = db.aql.execute(aql)
    return [dict(item) for item in cursor]


@router.post("")
def create_pattern(payload: PatternCreate) -> dict:
    db = get_db()
    ai_description = payload.ai_description
    if payload.ai_summary and not ai_description:
        ai_description = _llm_describe_pattern(payload.symbol, payload.bars, payload.llm)
    doc = {
        "name": payload.name,
        "symbol": payload.symbol,
        "bars": payload.bars,
        "end_date": payload.end_date,
        "params": payload.params.model_dump(),
        "thumbnail": payload.thumbnail,
        "ai_description": ai_description,
        "created_at": _now(),
        "updated_at": _now(),
    }
    meta = db.collection("search_patterns").insert(doc)
    return {**doc, "_key": meta["_key"]}


@router.put("/{key}")
def update_pattern(key: str, payload: PatternUpdate) -> dict:
    db = get_db()
    existing = _get_pattern(db, key)
    updates: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.symbol is not None:
        updates["symbol"] = payload.symbol
    if payload.bars is not None:
        updates["bars"] = payload.bars
    if payload.end_date is not None:
        updates["end_date"] = payload.end_date
    if payload.params is not None:
        updates["params"] = payload.params.model_dump()
    if payload.thumbnail is not None:
        updates["thumbnail"] = payload.thumbnail
    if payload.ai_description is not None:
        updates["ai_description"] = payload.ai_description
    updates["updated_at"] = _now()
    db.collection("search_patterns").update({"_key": key, **updates})
    return _get_pattern(db, key)


class PatternSearchRequest(BaseModel):
    ai_summary: bool = Field(default=False, description="以 LLM 對結果產生繁中補述")
    end_date: str | None = Field(
        default=None,
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        description="覆寫搜尋錨點；null = 用 pattern.end_date 或最新資料",
    )
    llm: dict = Field(default_factory=dict, description="LLM 連線設定（base_url/model/api_key/temperature/max_tokens）")


@router.post("/{key}/search")
def search_pattern(key: str, req: PatternSearchRequest) -> dict:
    db = get_db()
    pattern = _get_pattern(db, key)
    override_params = dict(pattern.get("params") or {})
    override_params["end_date"] = req.end_date
    results = search_universe(pattern, params=override_params)

    response: dict = {
        "pattern": pattern,
        "total": len(results),
        "results": results,
    }

    if req.ai_summary:
        summary, used = _llm_summarise(pattern, results, req.llm)
        response["ai_summary"] = summary
        response["used_fallback"] = used.get("fallback", False)
        response["fallback_model"] = used.get("model") if used.get("fallback") else None

    return response


def _llm_summarise(pattern: dict, results: list[dict], llm: dict) -> tuple[str, dict]:
    """Ask the configured LLM for a short Traditional-Chinese commentary on
    the matched stocks. Best-effort — failures fall back to an empty string."""
    from src.llm import chat_completion_with_fallback

    if not results:
        return "", {"fallback": False}
    try:
        top = ", ".join(f"{r['stock_id']}{' ' + (r['name'] or '') if r.get('name') else ''}" for r in results[:10])
        system = (
            "你是台股技術分析助手。使用者用圖表框選了一段K線走勢，系統找出走勢相似的股票。"
            "請用繁體中文簡短（100字內）說明這些股票可能具備的共同特徵與觀察重點。不要提供投資建議。"
        )
        user = (
            f"框選樣本來自 {pattern.get('symbol', '')}（{len(pattern.get('bars') or [])} 根K線），"
            f"找到 {len(results)} 檔相似股票，最相似的前幾檔：{top}。"
        )
        reply, used = chat_completion_with_fallback(
            llm=llm,
            system_prompt=system,
            user_prompt=user,
        )
        return reply, used
    except Exception as exc:  # LLM misconfig should not fail the search
        logger = __import__("logging").getLogger(__name__)
        logger.warning("LLM summary skipped: %s", exc)
        return "", {"fallback": False}


def _llm_describe_pattern(symbol: str, bars: list[float], llm: dict) -> str | None:
    """Ask the LLM for a short Traditional-Chinese description of a captured
    bar pattern (shape / trend). Best-effort — returns None on failure so the
    caller can store an empty value without aborting the save."""
    from src.llm import chat_completion_with_fallback

    if not bars:
        return None
    try:
        bars_str = ", ".join(f"{b:.2f}" for b in bars)
        system = (
            "你是台股技術分析助手。請用繁體中文簡短（60字內）描述使用者框選的一段K線"
            "走勢型態與趨勢特徵（例如：上升通道、底部反彈、頭肩底、V型反轉、區間整理、"
            "下降趨勢等）。不要提供投資建議。"
        )
        user = f"股票代號 {symbol}，共 {len(bars)} 根收盤價（依序）：{bars_str}"
        result, _used = chat_completion_with_fallback(
            llm=llm,
            system_prompt=system,
            user_prompt=user,
        )
        return (result or "").strip() or None
    except Exception as exc:  # LLM misconfig must not fail the pattern save
        logger = __import__("logging").getLogger(__name__)
        logger.warning("LLM pattern description skipped: %s", exc)
        return None


@router.delete("/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pattern(key: str) -> None:
    db = get_db()
    _get_pattern(db, key)
    db.collection("search_patterns").delete(key)
