"""indicatorRAG — 指標知識庫檢索層.

載入 `.docs/indicators/*.json`（64 份指標知識庫，權威來源，只讀不寫），
用本地 dllm 的 bge-m3 embedding（http://localhost:11400/v1，1024 維）做
cosine 相似度檢索，並依 `combines_with` 連帶拉取組合指標，最後依
`implementation.implemented` 過濾為「可執行」與「知識庫僅收錄」兩類。

用途：AI 搜索（選股條件生成）、監控（每日掃描）、解釋（為什麼選這檔）的
「推斷依據」——先檢索知識庫再讓 LLM 據此生成/驗證/解讀，而非靠 LLM 背答案。

獨立於 kag：不依賴 kag 部署狀態，知識庫就在 repo。
Embedding 服務掛掉時 graceful fallback 為關鍵字檢索，絕不讓 endpoint 500。
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
from pathlib import Path
from typing import Any

import httpx

from src.strategy import INDICATOR_CATALOG

logger = logging.getLogger(__name__)

CATALOG_METRICS = frozenset(m["metric"] for m in INDICATOR_CATALOG)

DEFAULT_DLLM_BASE_URL = "http://localhost:11400/v1"
DEFAULT_DLLM_API_KEY = "dllm-c1e09a8d-6622-4960-8f8d-1b7eef2a673e"
DEFAULT_DLLM_MODEL = "bge-m3"
DEFAULT_TOP_K = 5
DEFAULT_THRESHOLD = 0.3
EMBEDDING_TIMEOUT = 120.0
KEYWORD_SCORE = 0.5  # 關鍵字檢索的固定分數
COMBINES_WITH_FACTOR = 0.9  # 連帶拉取指標的分數 = 來源分數 × 0.9

# 檢索回應中對外輸出的欄位（RAG.md §五 API）
RESULT_FIELDS = (
    "metric",
    "name",
    "category",
    "definition",
    "formula",
    "implemented",
    "signals",
    "combines_with",
    "score",
    "source",
    "executable_as",
)


def default_kb_path() -> Path:
    """知識庫路徑：環境變數 INDICATOR_KB_PATH 優先，否則 repo 根/.docs/indicators。

    backend/src/indicator_rag.py 往上三層（src → backend → repo 根）。
    """
    env = os.environ.get("INDICATOR_KB_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / ".docs" / "indicators"


def _extract_tw_convention(parameters: Any) -> str:
    """從 parameters[].tw_convention 收集台股慣例（去重、去空）。"""
    if not isinstance(parameters, list):
        return ""
    seen: list[str] = []
    for p in parameters:
        if isinstance(p, dict):
            value = str(p.get("tw_convention") or "").strip()
            if value and value not in seen:
                seen.append(value)
    return "；".join(seen)


def _extract_signals(signals: Any) -> list[str]:
    """signals[].pattern 的 pattern 字串清單（訊號語意）。"""
    if not isinstance(signals, list):
        return []
    patterns: list[str] = []
    for s in signals:
        if isinstance(s, dict):
            pattern = str(s.get("pattern") or "").strip()
            if pattern and pattern not in patterns:
                patterns.append(pattern)
    return patterns


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_document(raw: Any, filename: str) -> dict | None:
    """把一份指標 JSON 正規化成 document（缺欄位容錯）。"""
    if not isinstance(raw, dict):
        logger.warning("Skipping %s: not a JSON object", filename)
        return None
    metric = str(raw.get("metric") or "").strip()
    if not metric:
        logger.warning("Skipping %s: missing metric field", filename)
        return None
    implementation = raw.get("implementation") if isinstance(raw.get("implementation"), dict) else {}
    parameters = raw.get("parameters") if isinstance(raw.get("parameters"), list) else []
    return {
        "metric": metric,
        "name": str(raw.get("name") or metric),
        "category": str(raw.get("category") or ""),
        "definition": str(raw.get("definition") or ""),
        "formula": str(raw.get("formula") or ""),
        "parameters": parameters,
        "tw_convention": _extract_tw_convention(parameters),
        "signals": _extract_signals(raw.get("signals")),
        "combines_with": _string_list(raw.get("combines_with")),
        "implemented": bool(implementation.get("implemented", False)),
        "catalog_metric": _string_list(str(implementation.get("catalog_metric") or "").split("/")),
    }


def load_knowledge_base(path: str | Path) -> list[dict]:
    """掃描目錄所有 *.json，轉成 document 清單；壞 JSON 跳過並 log warning。"""
    kb_dir = Path(path)
    if not kb_dir.is_dir():
        logger.warning("Indicator knowledge base directory not found: %s", kb_dir)
        return []
    documents: list[dict] = []
    for json_file in sorted(kb_dir.glob("*.json")):
        try:
            with open(json_file, encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping invalid indicator JSON %s: %s", json_file.name, exc)
            continue
        doc = _normalize_document(raw, json_file.name)
        if doc is not None:
            documents.append(doc)
    logger.info("Loaded %d indicator documents from %s", len(documents), kb_dir)
    return documents


def build_embed_text(doc: dict) -> str:
    """嵌入文本 = name + definition + formula + signals + tw_convention 的繁中拼接。"""
    signals = "、".join(doc.get("signals") or [])
    tw_convention = doc.get("tw_convention") or ""
    return (
        f"{doc.get('name')}。{doc.get('definition')} {doc.get('formula')} "
        f"訊號：{signals} 參數慣例：{tw_convention}"
    )


def format_evidence(results: list[dict], max_len: int = 80) -> str:
    """把檢索結果做成 LLM 證據字串（每行一個指標）。"""
    lines: list[str] = []
    for r in results:
        definition = str(r.get("definition") or "").replace("\n", " ")[:max_len]
        formula = str(r.get("formula") or "").replace("\n", " ")[:max_len]
        lines.append(f"- {r['metric']}（{r['name']}）：{definition}，公式 {formula}")
    return "\n".join(lines)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """純 Python cosine 相似度（標準庫 math，不引入新依賴）。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


class IndicatorRAG:
    """指標知識庫檢索器：載入 JSON → embed → cosine 檢索 → combines_with 連帶拉取。"""

    def __init__(
        self,
        kb_path: str | Path | None = None,
        dllm_base_url: str | None = None,
        dllm_api_key: str | None = None,
        dllm_model: str | None = None,
        top_k: int = DEFAULT_TOP_K,
        threshold: float = DEFAULT_THRESHOLD,
    ) -> None:
        """Lazy build：建構只存參數，不載入知識庫、不呼叫 embedding。"""
        self.kb_path = Path(kb_path) if kb_path else default_kb_path()
        self.dllm_base_url = (dllm_base_url or DEFAULT_DLLM_BASE_URL).rstrip("/")
        self.dllm_api_key = dllm_api_key or os.environ.get("DLLM_API_KEY") or DEFAULT_DLLM_API_KEY
        self.dllm_model = dllm_model or DEFAULT_DLLM_MODEL
        self.top_k = max(1, top_k)
        self.threshold = threshold
        self._documents: list[dict] = []
        self._embeddings: list[list[float]] | None = None
        self._built = False
        self._build_lock = threading.Lock()

    # ------------------------------------------------------------------ build

    def _ensure_built(self) -> None:
        """Lazy build（thread-safe）：載入文件 + 批次 embedding。

        embedding 失敗不 raise——留空並讓 search 走關鍵字 fallback。
        """
        if self._built:
            return
        with self._build_lock:
            if self._built:
                return
            self._documents = load_knowledge_base(self.kb_path)
            if self._documents:
                try:
                    self._embeddings = self._embed(
                        [build_embed_text(d) for d in self._documents]
                    )
                    logger.info(
                        "Embedded %d indicator documents with %s (dims=%d)",
                        len(self._documents),
                        self.dllm_model,
                        len(self._embeddings[0]) if self._embeddings else 0,
                    )
                except Exception as exc:  # noqa: BLE001 — 任何 embedding 失敗都走 fallback
                    self._embeddings = None
                    logger.warning(
                        "Embedding unavailable (%s) — indicatorRAG falls back to keyword search",
                        exc,
                    )
            self._built = True

    # --------------------------------------------------------------- embedding

    def _embed(self, texts: list[str]) -> list[list[float]]:
        """POST {base}/embeddings（OpenAI 相容，批次陣列）；批次失敗則逐筆。"""
        if not texts:
            return []
        try:
            return self._embed_batch(texts)
        except RuntimeError as exc:
            logger.warning("Batch embedding failed (%s) — retrying per-item", exc)
            return [self._embed_one(t) for t in texts]

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        payload = {"model": self.dllm_model, "input": texts}
        data = self._post_embeddings(payload)
        try:
            items = sorted(data["data"], key=lambda item: item["index"])
            return [list(item["embedding"]) for item in items]
        except (KeyError, TypeError) as exc:
            raise RuntimeError("Embedding 回傳格式無法解析（batch）") from exc

    def _embed_one(self, text: str) -> list[float]:
        payload = {"model": self.dllm_model, "input": text}
        data = self._post_embeddings(payload)
        try:
            return list(data["data"][0]["embedding"])
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Embedding 回傳格式無法解析（單筆）") from exc

    def _post_embeddings(self, payload: dict) -> dict:
        url = f"{self.dllm_base_url}/embeddings"
        headers = {"Content-Type": "application/json"}
        if self.dllm_api_key:
            headers["Authorization"] = f"Bearer {self.dllm_api_key}"
        try:
            with httpx.Client(timeout=EMBEDDING_TIMEOUT) as client:
                resp = client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Embedding 服務連線失敗：{exc}") from exc
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Embedding 請求失敗 ({resp.status_code})：{resp.text[:200]}"
            )
        return resp.json()

    # ------------------------------------------------------------------ search

    def search(
        self,
        query: str,
        top_k: int | None = None,
        threshold: float | None = None,
    ) -> dict:
        """檢索主流程：embed query → cosine top-k → combines_with 連帶拉取 → 分類。

        回傳 {query, results, executable_metrics, knowledge_only_metrics,
        embedding_available}。embedding 失敗時自動改關鍵字檢索，永不 500。
        """
        query = (query or "").strip()
        k = max(1, top_k or self.top_k)
        thr = threshold if threshold is not None else self.threshold
        self._ensure_built()

        if not query:
            return self._empty_result(query, embedding_available=self._embeddings is not None)

        if self._embeddings:
            try:
                results = self._semantic_search(query, k, thr)
                embedding_available = True
            except Exception as exc:  # noqa: BLE001 — dllm 中途掛掉就降級關鍵字
                logger.warning(
                    "Semantic search failed (%s) — keyword fallback for query %r",
                    exc,
                    query,
                )
                results = self._keyword_search(query)
                embedding_available = False
        else:
            results = self._keyword_search(query)
            embedding_available = False

        results = self._attach_combines_with(results)

        # 可執行性以 INDICATOR_CATALOG 為權威：知識庫 macd.json 標 true，但
        # catalog 只有 macd_dif/signal/hist——AI 用 macd 會被 _validate_conditions
        # 丟棄，故以 catalog 白名單對帳；整合檔（如 macd）靠 catalog_metric 映射。
        executable: list[str] = []
        knowledge_only: list[str] = []
        for r in results:
            if not r["implemented"]:
                knowledge_only.append(r["metric"])
                continue
            if r["metric"] in CATALOG_METRICS:
                executable.append(r["metric"])
            else:
                mapped = [m for m in r.get("executable_as", []) if m in CATALOG_METRICS]
                if mapped:
                    executable.append(r["metric"])
                    r["executable_as"] = mapped
                else:
                    knowledge_only.append(r["metric"])

        return {
            "query": query,
            "results": results,
            "executable_metrics": executable,
            "knowledge_only_metrics": knowledge_only,
            "embedding_available": embedding_available,
        }

    def _empty_result(self, query: str, embedding_available: bool) -> dict:
        return {
            "query": query,
            "results": [],
            "executable_metrics": [],
            "knowledge_only_metrics": [],
            "embedding_available": embedding_available,
        }

    def _semantic_search(self, query: str, top_k: int, threshold: float) -> list[dict]:
        query_vector = self._embed_one(query)
        scored: list[tuple[float, dict]] = []
        for doc, vector in zip(self._documents, self._embeddings or []):
            score = _cosine_similarity(query_vector, vector)
            if score > threshold:
                scored.append((score, doc))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            self._result_dict(doc, score, "semantic")
            for score, doc in scored[:top_k]
        ]

    def _keyword_search(self, query: str) -> list[dict]:
        """Graceful fallback：query 子字串比對 metric/name/definition，固定分數 0.5。"""
        hits: list[dict] = []
        for doc in self._documents:
            haystack = " ".join(
                [
                    doc["metric"],
                    doc["name"],
                    doc["definition"],
                ]
            )
            if query in haystack:
                hits.append(self._result_dict(doc, KEYWORD_SCORE, "keyword"))
        return hits

    def _attach_combines_with(self, results: list[dict]) -> list[dict]:
        """連帶拉取：top-k 的 combines_with 指向的指標也帶上（組合推斷）。"""
        by_metric = {doc["metric"]: doc for doc in self._documents}
        present = {r["metric"] for r in results}
        pulled: list[dict] = []
        for r in results:
            for target in r.get("combines_with") or []:
                doc = by_metric.get(target)
                if doc is None or target in present:
                    continue
                present.add(target)
                pulled.append(
                    self._result_dict(
                        doc,
                        score=round(float(r["score"]) * COMBINES_WITH_FACTOR, 4),
                        source="combines_with",
                    )
                )
        return results + pulled

    def _result_dict(self, doc: dict, score: float, source: str) -> dict:
        return {
            "metric": doc["metric"],
            "name": doc["name"],
            "category": doc["category"],
            "definition": doc["definition"],
            "formula": doc["formula"],
            "implemented": doc["implemented"],
            "signals": doc["signals"],
            "combines_with": doc["combines_with"],
            "score": round(float(score), 4),
            "source": source,
            "executable_as": doc.get("catalog_metric", []),
        }

    # ------------------------------------------------------------------ misc

    @property
    def documents(self) -> list[dict]:
        """檢視已載入的 documents（lazy build 觸發）。測試/除錯用。"""
        self._ensure_built()
        return self._documents


# ------------------------------------------------------------------ singleton

_rag_instance: IndicatorRAG | None = None
_rag_instance_lock = threading.Lock()


def get_rag() -> IndicatorRAG:
    """模組層級共享實例（lazy init，thread-safe）。"""
    global _rag_instance
    if _rag_instance is None:
        with _rag_instance_lock:
            if _rag_instance is None:
                _rag_instance = IndicatorRAG()
    return _rag_instance
