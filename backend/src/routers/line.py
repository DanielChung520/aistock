"""LINE OA integration: webhook (follower + chat capture), recipient authorization,
per-source settings, and source-scoped pushes.

Source settings live with each feature (``PUT /api/line/sources/{key}``); recipient
management authorizes *who* receives each source. Credentials live in
``sdk/lineOA/.env`` and never reach the browser.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from src import line_notify
from src.db import get_db
from src.line_sources import LINE_SOURCES, is_known_source, source_keys

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/line", tags=["line"])

RECIPIENTS_COLLECTION = "line_recipients"
MESSAGES_COLLECTION = "line_messages"
SOURCES_COLLECTION = "line_sources"


def ensure_collections() -> None:
    db = get_db()
    for name in (RECIPIENTS_COLLECTION, MESSAGES_COLLECTION, SOURCES_COLLECTION):
        if not db.has_collection(name):
            db.create_collection(name)


class RecipientUpdate(BaseModel):
    note: str | None = None
    category: str | None = None
    subscriptions: dict[str, bool] | None = None


class SourceSettings(BaseModel):
    enabled: bool


class SendRequest(BaseModel):
    source: str
    text: str


def _now() -> float:
    return time.time()


def _default_subscriptions() -> dict[str, bool]:
    return {key: True for key in source_keys()}


def _normalize_subscriptions(raw: object) -> dict[str, bool]:
    base = _default_subscriptions()
    if isinstance(raw, dict):
        for key, value in raw.items():
            if is_known_source(key):
                base[key] = bool(value)
    return base


def source_states() -> list[dict[str, object]]:
    col = get_db().collection(SOURCES_COLLECTION)
    states: list[dict[str, object]] = []
    for source in LINE_SOURCES:
        doc = col.get(source["key"]) if col.has(source["key"]) else {}
        states.append({**source, "enabled": bool(doc.get("enabled", True))})
    return states


def source_enabled(key: str) -> bool:
    col = get_db().collection(SOURCES_COLLECTION)
    return bool(col.get(key, {}).get("enabled", True)) if col.has(key) else True


def _upsert_recipient(user_id: str, *, followed: bool) -> None:
    col = get_db().collection(RECIPIENTS_COLLECTION)
    profile = line_notify.get_profile(user_id) if followed else None
    existing = col.get(user_id) if col.has(user_id) else None
    subscriptions = _normalize_subscriptions((existing or {}).get("subscriptions"))
    if existing and existing.get("enabled") is False:
        subscriptions = {key: False for key in source_keys()}
    doc = {
        "_key": user_id,
        "user_id": user_id,
        "status": "followed" if followed else "blocked",
        "note": (existing or {}).get("note", ""),
        "category": (existing or {}).get("category", ""),
        "subscriptions": subscriptions,
        "display_name": (profile or {}).get("displayName") or (existing or {}).get("display_name", ""),
        "picture_url": (profile or {}).get("pictureUrl") or (existing or {}).get("picture_url", ""),
        "added_at": (existing or {}).get("added_at", _now()),
        "updated_at": _now(),
    }
    col.insert(doc, overwrite=True)


def _store_message(user_id: str, direction: str, text: str) -> None:
    get_db().collection(MESSAGES_COLLECTION).insert(
        {"user_id": user_id, "direction": direction, "text": text, "at": _now()}
    )


def _seed_default_recipient() -> None:
    user_id = line_notify.default_user_id()
    if not user_id:
        return
    col = get_db().collection(RECIPIENTS_COLLECTION)
    if not col.has(user_id):
        col.insert(
            {
                "_key": user_id,
                "user_id": user_id,
                "status": "followed",
                "note": "",
                "category": "",
                "subscriptions": _default_subscriptions(),
                "display_name": "（預設）",
                "picture_url": "",
                "added_at": _now(),
                "updated_at": _now(),
            },
            overwrite=True,
        )


def refresh_profile(user_id: str) -> dict[str, str] | None:
    profile = line_notify.get_profile(user_id)
    if not profile:
        return None
    display_name = str(profile.get("displayName") or "")
    picture_url = str(profile.get("pictureUrl") or "")
    col = get_db().collection(RECIPIENTS_COLLECTION)
    if col.has(user_id):
        col.update(
            {"_key": user_id, "display_name": display_name, "picture_url": picture_url, "updated_at": _now()}
        )
    return {"display_name": display_name, "picture_url": picture_url}


def subscribed_recipient_ids(source: str) -> list[str]:
    ensure_collections()
    cursor = get_db().aql.execute(
        """
        FOR r IN line_recipients
          FILTER r.status == 'followed'
          FILTER r.subscriptions[@source] != false
          RETURN r.user_id
        """,
        bind_vars={"source": source},
    )
    return [row for row in cursor]


def push_source(source: str, text: str) -> int:
    """Push ``text`` to followers subscribed to ``source`` (no-op when disabled)."""
    if not is_known_source(source) or not source_enabled(source):
        return 0
    recipients = subscribed_recipient_ids(source)
    sent = line_notify.push_text(recipients, text)
    if sent:
        for user_id in recipients:
            _store_message(user_id, "out", text)
    return sent


@router.post("/webhook")
async def line_webhook(request: Request) -> dict[str, bool]:
    body = await request.body()
    signature = request.headers.get("X-Line-Signature")
    if not line_notify.verify_signature(body, signature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid signature")
    ensure_collections()
    payload = await request.json()
    for event in payload.get("events", []):
        event_type = event.get("type")
        user_id = (event.get("source") or {}).get("userId")
        if not user_id:
            continue
        if event_type == "follow":
            _upsert_recipient(user_id, followed=True)
        elif event_type == "unfollow":
            _upsert_recipient(user_id, followed=False)
        elif event_type == "message":
            message = event.get("message") or {}
            if message.get("type") == "text":
                _store_message(user_id, "in", str(message.get("text", "")))
    return {"ok": True}


@router.get("/sources")
def list_sources() -> dict[str, object]:
    ensure_collections()
    return {"sources": source_states()}


@router.put("/sources/{source_key}")
def put_source(source_key: str, payload: SourceSettings) -> dict[str, object]:
    if not is_known_source(source_key):
        raise HTTPException(status_code=404, detail="unknown source")
    ensure_collections()
    get_db().collection(SOURCES_COLLECTION).insert(
        {"_key": source_key, "enabled": payload.enabled, "updated_at": _now()}, overwrite=True
    )
    return {"sources": source_states()}


@router.get("/recipients")
def list_recipients() -> dict[str, object]:
    ensure_collections()
    _seed_default_recipient()
    cursor = get_db().aql.execute(
        "FOR r IN line_recipients SORT r.updated_at DESC RETURN r"
    )
    recipients = [
        {
            **dict(row),
            "note": dict(row).get("note") or "",
            "category": dict(row).get("category") or "",
            "subscriptions": _normalize_subscriptions(row.get("subscriptions")),
        }
        for row in cursor
    ]
    for recipient in recipients:
        if not recipient["display_name"] or recipient["display_name"] == "（預設）":
            refreshed = refresh_profile(recipient["user_id"])
            if refreshed:
                recipient.update(refreshed)
    return {
        "recipients": recipients,
        "sources": source_states(),
        "configured": line_notify.is_configured(),
    }


@router.patch("/recipients/{user_id}")
def update_recipient(user_id: str, payload: RecipientUpdate) -> dict[str, object]:
    col = get_db().collection(RECIPIENTS_COLLECTION)
    if not col.has(user_id):
        raise HTTPException(status_code=404, detail="recipient not found")
    update: dict[str, object] = {"_key": user_id, "updated_at": _now()}
    if payload.note is not None:
        update["note"] = payload.note
    if payload.category is not None:
        update["category"] = payload.category
    if payload.subscriptions is not None:
        update["subscriptions"] = _normalize_subscriptions(payload.subscriptions)
    col.update(update)
    return dict(col.get(user_id))


@router.post("/recipients/{user_id}/refresh")
def refresh_recipient(user_id: str) -> dict[str, object]:
    refreshed = refresh_profile(user_id)
    if not refreshed:
        raise HTTPException(
            status_code=404,
            detail="無法取得 LINE 名稱（使用者可能未加 OA 或已封鎖）",
        )
    return refreshed


@router.delete("/recipients/{user_id}")
def delete_recipient(user_id: str) -> dict[str, bool]:
    col = get_db().collection(RECIPIENTS_COLLECTION)
    if col.has(user_id):
        col.delete(user_id)
    return {"ok": True}


@router.get("/recipients/{user_id}/messages")
def list_messages(user_id: str, limit: int = 100) -> dict[str, object]:
    ensure_collections()
    cursor = get_db().aql.execute(
        """
        FOR m IN line_messages
          FILTER m.user_id == @user_id
          SORT m.at DESC
          LIMIT @limit
          RETURN m
        """,
        bind_vars={"user_id": user_id, "limit": limit},
    )
    return {"messages": list(reversed([dict(row) for row in cursor]))}


@router.post("/send")
def send(payload: SendRequest) -> dict[str, object]:
    if not is_known_source(payload.source):
        raise HTTPException(status_code=404, detail="unknown source")
    sent = push_source(payload.source, payload.text)
    return {"sent": sent, "source": payload.source}
