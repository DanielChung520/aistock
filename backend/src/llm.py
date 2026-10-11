"""OpenAI-compatible LLM client for the AI stock screener.

Calls any OpenAI-compatible chat-completions endpoint (OpenAI, Gemini
openai-compat, Ollama, LM Studio, etc.) using the connection settings the
user configures in the frontend 一般設定 tab. The call is stateless: the
full settings object is passed in by the router on every request.
"""
from __future__ import annotations

import json
import logging
import re

import httpx

logger = logging.getLogger(__name__)

COMPLETIONS_PATH = "/chat/completions"


def _resolve_base_url(base_url: str) -> str:
    """Normalise a user-supplied base URL into an OpenAI-compatible root."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("LLM base_url 未設定，請在 系統設定 → 一般設定 中填寫")
    if base.endswith("/v1") or base.endswith("/openai"):
        # Gemini 的 OpenAI 相容根路徑為 .../v1beta/openai（尾端非 /v1）
        return base
    return f"{base}/v1"


def chat_completion(
    *,
    base_url: str,
    model: str,
    api_key: str,
    temperature: float,
    max_tokens: int,
    system_prompt: str,
    user_prompt: str,
    timeout: float = 60.0,
) -> str:
    """Send one chat request and return the assistant's text reply."""
    url = _resolve_base_url(base_url) + COMPLETIONS_PATH
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            logger.error("LLM request failed: %s %s", resp.status_code, resp.text[:500])
            raise RuntimeError(f"LLM 請求失敗 ({resp.status_code})：{resp.text[:200]}")
        data = resp.json()

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        logger.error("Unexpected LLM response shape: %s", json.dumps(data)[:500])
        raise RuntimeError("LLM 回傳格式無法解析") from exc


def extract_json_object(text: str) -> dict:
    """Extract a JSON object from an LLM reply.

    Robust against reasoning-model noise: strips ```json fences and
    <think>...</think> blocks, then scans for the largest parseable
    {...} object anywhere in the reply.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Scan every '{' for a complete JSON object; pick the longest one, since
    # reasoning text may contain small unrelated {...} fragments.
    decoder = json.JSONDecoder()
    best: dict | None = None
    best_len = -1
    search_from = 0
    while True:
        start = cleaned.find("{", search_from)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(cleaned, start)
        except json.JSONDecodeError:
            search_from = start + 1
            continue
        if isinstance(obj, dict) and end - start > best_len:
            best, best_len = obj, end - start
        search_from = start + 1
    if best is not None:
        return best
    raise ValueError("LLM 未回傳有效的 JSON 條件")


def chat_completion_with_fallback(
    *,
    llm: dict,
    system_prompt: str,
    user_prompt: str,
    timeout: float = 60.0,
) -> tuple[str, dict]:
    """Call chat_completion with an optional local-dllm fallback.

    `llm` carries the primary connection settings plus an optional
    `fallback` dict ({enabled, base_url, model, api_key}). When the primary
    call fails (auth error, network error, bad response) and fallback is
    enabled, retry against the local dllm service. Returns
    `(reply_text, used)` where `used` is a dict describing which endpoint
    served the reply: {"fallback": False} or
    {"fallback": True, "base_url": ..., "model": ...}.

    Raises RuntimeError only if the primary fails AND no usable fallback is
    configured (or the fallback also fails).
    """
    fallback: dict = (llm or {}).get("fallback") or {}
    fb_enabled = bool(fallback.get("enabled", True))
    fb_base_url = str(fallback.get("base_url") or "")
    fb_model = str(fallback.get("model") or "")
    fb_api_key = str(fallback.get("api_key") or "")

    try:
        reply = chat_completion(
            base_url=str((llm or {}).get("base_url", "")),
            model=str((llm or {}).get("model", "")),
            api_key=str((llm or {}).get("api_key", "")),
            temperature=float((llm or {}).get("temperature", 0.1)),
            max_tokens=int((llm or {}).get("max_tokens", 2000)),
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )
        return reply, {"fallback": False}
    except (ValueError, RuntimeError) as primary_exc:
        if not (fb_enabled and fb_base_url and fb_model and fb_api_key):
            logger.warning("LLM primary failed, no usable fallback: %s", primary_exc)
            raise
        logger.warning(
            "LLM primary failed (%s) — falling back to dllm %s", primary_exc, fb_model
        )
        try:
            reply = chat_completion(
                base_url=fb_base_url,
                model=fb_model,
                api_key=fb_api_key,
                temperature=float((llm or {}).get("temperature", 0.1)),
            max_tokens=int((llm or {}).get("max_tokens", 2000)),
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                timeout=timeout,
            )
        except (ValueError, RuntimeError) as fb_exc:
            raise RuntimeError(
                f"主要 LLM 與本機 dllm 皆失敗：{primary_exc}；dllm: {fb_exc}"
            ) from fb_exc
        return reply, {"fallback": True, "base_url": fb_base_url, "model": fb_model}
