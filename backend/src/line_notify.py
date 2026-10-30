"""LINE Messaging API client for the aistock LINE OA.

Credentials live in ``sdk/lineOA/.env`` (channel id / secret / access token). The
webhook signature is verified with the channel secret; pushes use the channel
access token. Secrets are never logged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
LINE_ENV_PATH = REPO_ROOT / "sdk" / "lineOA" / ".env"
LINE_API = "https://api.line.me"

_env_loaded = False


def _load() -> None:
    global _env_loaded
    if not _env_loaded:
        load_dotenv(LINE_ENV_PATH)
        _env_loaded = True


def channel_secret() -> str | None:
    _load()
    return os.environ.get("Channel_secret") or os.environ.get("LINE_CHANNEL_SECRET")


def access_token() -> str | None:
    _load()
    return (
        os.environ.get("access_token")
        or os.environ.get("assess_token")
        or os.environ.get("LINE_CHANNEL_ACCESS_TOKEN")
    )


def default_user_id() -> str | None:
    _load()
    return os.environ.get("Your_user_ID")


def verify_signature(body: bytes, signature: str | None) -> bool:
    secret = channel_secret()
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    return hmac.compare_digest(base64.b64encode(digest).decode("utf-8"), signature)


def _auth_headers() -> dict[str, str]:
    token = access_token()
    if not token:
        raise RuntimeError("LINE access token missing (sdk/lineOA/.env)")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def get_profile(user_id: str) -> dict[str, Any] | None:
    try:
        response = httpx.get(
            f"{LINE_API}/v2/bot/profile/{user_id}", headers=_auth_headers(), timeout=10.0
        )
        if response.status_code != 200:
            return None
        return response.json()
    except httpx.HTTPError as exc:
        logger.warning("LINE profile fetch failed for %s: %s", user_id, exc)
        return None


def push_text(user_ids: list[str], text: str) -> int:
    """Push a text message to the given user ids. Returns the number targeted."""
    targets = [uid for uid in dict.fromkeys(user_ids) if uid]
    if not targets:
        return 0
    payload = {"to": targets, "messages": [{"type": "text", "text": text[:4900]}]}
    endpoint = (
        f"{LINE_API}/v2/bot/message/push"
        if len(targets) == 1
        else f"{LINE_API}/v2/bot/message/multicast"
    )
    try:
        response = httpx.post(endpoint, headers=_auth_headers(), json=payload, timeout=15.0)
        if response.status_code >= 400:
            logger.warning("LINE push failed (%s): %s", response.status_code, response.text[:300])
            return 0
        return len(targets)
    except httpx.HTTPError as exc:
        logger.warning("LINE push error: %s", exc)
        return 0


def follower_ids() -> list[str] | None:
    """User ids that added the OA (Messaging API ``followers/ids``), or None when the
    account does not have access to that API (unverified / free tier returns 403)."""
    ids: list[str] = []
    start: str | None = None
    try:
        while True:
            params: dict[str, object] = {"limit": 1000}
            if start:
                params["start"] = start
            response = httpx.get(
                f"{LINE_API}/v2/bot/followers/ids",
                headers=_auth_headers(),
                params=params,
                timeout=15.0,
            )
            if response.status_code >= 400:
                logger.warning(
                    "LINE followers/ids unavailable (%s): %s", response.status_code, response.text[:200]
                )
                return None
            data = response.json()
            ids.extend(data.get("userIds") or [])
            start = data.get("next")
            if not start:
                break
    except httpx.HTTPError as exc:
        logger.warning("LINE followers/ids error: %s", exc)
        return None
    return ids


def is_configured() -> bool:
    return bool(access_token())
