"""Tests for /api/strategy-hits endpoints (write, list, read/unread, expiry)."""
from __future__ import annotations

import time

DEFAULT_HIT = {
    "stock_id": "2330",
    "name": "台積電",
    "score": 100.0,
    "price": 1025.0,
    "passed_count": 1,
    "total_conditions": 1,
    "condition_results": [],
    "date": "2026-08-10",
    "passed": True,
}


def _post_hits(client, **overrides):
    body = {
        "scan_id": "scan_test_1",
        "scope": "all",
        "source": "manual",
        "conditions": [{"metric": "ma_bull", "op": "==", "value": True, "note": "test"}],
        "hits": [DEFAULT_HIT],
    }
    body.update(overrides)
    return client.post("/api/strategy-hits", json=body)


def test_post_hits_writes_with_expected_key(client, db, clean_hits):
    resp = _post_hits(client)
    assert resp.status_code == 200
    assert resp.json()["written"] == 1
    assert db.collection("strategy_hits").has("scan_test_1_2330")


def test_post_hits_idempotent_on_same_scan(client, db, clean_hits):
    _post_hits(client)
    _post_hits(client)
    count = db.aql.execute("FOR h IN strategy_hits COLLECT WITH COUNT INTO c RETURN c")
    assert list(count)[0] == 1


def test_post_empty_hits_writes_nothing(client, db, clean_hits):
    resp = _post_hits(client, hits=[])
    assert resp.status_code == 200
    assert resp.json()["written"] == 0
    assert len(list(db.aql.execute("FOR h IN strategy_hits RETURN h"))) == 0


def test_get_list_unread_first_orders_unread_above_read(client, clean_hits):
    _post_hits(client, scan_id="scan_a")
    client.put("/api/strategy-hits/scan_a_2330/read")
    _post_hits(client, scan_id="scan_b")
    resp = client.get("/api/strategy-hits?unread_first=true")
    body = resp.json()
    assert body["total"] == 2
    assert body["results"][0]["scan_id"] == "scan_b"
    assert body["results"][0]["read"] is False


def test_get_list_before_cursor_pagination(client, clean_hits):
    _post_hits(client, scan_id="scan_old")
    cutoff_ts = time.time() + 0.5
    time.sleep(1.1)
    _post_hits(client, scan_id="scan_new")
    resp = client.get(f"/api/strategy-hits?before={cutoff_ts}")
    body = resp.json()
    keys = [r["_key"] for r in body["results"]]
    assert "scan_old_2330" in keys
    assert "scan_new_2330" not in keys


def test_unread_count_after_mark_read(client, clean_hits):
    _post_hits(client, scan_id="scan_1")
    assert client.get("/api/strategy-hits/unread-count").json()["unread"] == 1
    client.put("/api/strategy-hits/scan_1_2330/read")
    assert client.get("/api/strategy-hits/unread-count").json()["unread"] == 0


def test_mark_read_404_on_unknown(client, clean_hits):
    resp = client.put("/api/strategy-hits/nonexistent_key/read")
    assert resp.status_code == 404


def test_read_all_clears_unread(client, clean_hits):
    _post_hits(client, scan_id="s1")
    _post_hits(
        client,
        scan_id="s2",
        hits=[{**DEFAULT_HIT, "stock_id": "2317", "name": "鴻海", "price": 215.0}],
    )
    resp = client.put("/api/strategy-hits/read-all")
    assert resp.status_code == 200
    assert resp.json()["marked"] == 2
    assert client.get("/api/strategy-hits/unread-count").json()["unread"] == 0


def test_expiry_filter_excludes_old_read_docs(client, db, clean_hits):
    old_ts = time.time() - 31 * 86400
    db.collection("strategy_hits").insert({
        "_key": "old_read",
        "stock_id": "9999", "name": "old", "scope": "all",
        "conditions": [], "passed_count": 0, "total_conditions": 0,
        "score": 0, "price": 0, "source": "manual",
        "scan_at": old_ts, "read": True, "created_at": old_ts,
    }, overwrite=True)
    resp = client.get("/api/strategy-hits?unread_first=false")
    keys = [r["_key"] for r in resp.json()["results"]]
    assert "old_read" not in keys


def test_expiry_keeps_old_unread(client, db, clean_hits):
    old_ts = time.time() - 31 * 86400
    db.collection("strategy_hits").insert({
        "_key": "old_unread",
        "stock_id": "9999", "name": "old", "scope": "all",
        "conditions": [], "passed_count": 0, "total_conditions": 0,
        "score": 0, "price": 0, "source": "manual",
        "scan_at": old_ts, "read": False, "created_at": old_ts,
    }, overwrite=True)
    resp = client.get("/api/strategy-hits?unread_first=false")
    keys = [r["_key"] for r in resp.json()["results"]]
    assert "old_unread" in keys


def test_malformed_post_returns_4xx(client, clean_hits):
    resp = client.post("/api/strategy-hits", json={"scope": "all", "hits": []})
    assert resp.status_code == 422
    resp2 = client.post("/api/strategy-hits", json={
        "scan_id": "x", "scope": "all", "source": "bogus", "hits": []
    })
    assert resp2.status_code == 422
