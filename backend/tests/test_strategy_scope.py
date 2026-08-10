"""Tests for _resolve_scope and /api/strategy/industries."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.routers.strategy import _resolve_scope


def test_resolve_scope_all_returns_all_stocks(db):
    result = _resolve_scope(db, "all")
    assert set(result.keys()) == {"2330", "2317", "0050"}


def test_resolve_scope_watchlist_filters_to_watchlist(db):
    result = _resolve_scope(db, "watchlist")
    assert set(result.keys()) == {"2330", "0050"}


def test_resolve_scope_sector_filters_by_industry(db):
    result = _resolve_scope(db, "sector:半導體")
    assert set(result.keys()) == {"2330"}


def test_resolve_scope_sector_unknown_returns_empty(db):
    result = _resolve_scope(db, "sector:不存在")
    assert result == {}


def test_resolve_scope_invalid_raises_400(db):
    with pytest.raises(HTTPException) as exc_info:
        _resolve_scope(db, "bogus")
    assert exc_info.value.status_code == 400


def test_industries_endpoint_returns_distinct(db, client):
    resp = client.get("/api/strategy/industries")
    assert resp.status_code == 200
    body = resp.json()
    industries = {x["industry"]: x["count"] for x in body["industries"]}
    assert industries.get("半導體") == 1
    assert industries.get("其他電子") == 1
    assert industries.get("ETF") == 1
    assert body["total"] == 3
