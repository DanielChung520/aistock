"""Data Source Registry tests — load integrity + resolve order + API (no I/O beyond JSON).

Covers `.docs/datasources/SCHEMA.md`: unique priorities, planned skipped, source
`provides[].dataset` must exist in the vocabulary (drift guard).
"""
from __future__ import annotations

import pytest

from src.datasources import registry


def test_datasets_loaded_and_shaped():
    datasets = registry.datasets()
    assert datasets
    for name, dataset in datasets.items():
        assert dataset.get("sources"), f"{name} has no sources"


def test_priorities_unique_per_dataset():
    for name, dataset in registry.datasets().items():
        priorities = [s["priority"] for s in dataset["sources"]]
        assert len(priorities) == len(set(priorities)), name


def test_resolve_orders_by_priority():
    assert registry.resolve("quote.daily") == ["fubon", "yfinance"]
    assert registry.resolve("index.intraday") == ["fubon"]


def test_resolve_skips_planned_unless_requested():
    assert registry.resolve("dividend.policy") == ["finmind"]
    assert registry.resolve("dividend.policy", include_planned=True) == ["finmind", "mops"]


def test_resolve_unknown_dataset_raises():
    with pytest.raises(KeyError):
        registry.resolve("does.not.exist")


def test_source_files_only_reference_known_datasets():
    vocabulary = set(registry.datasets())
    for source_id, source in registry.sources().items():
        for provided in source.get("provides", []):
            assert provided["dataset"] in vocabulary, f"{source_id} -> {provided['dataset']}"


def test_api_lists_and_resolves(client):
    listed = client.get("/api/datasources")
    assert listed.status_code == 200
    body = listed.json()
    assert "dividend.policy" in body["datasets"]
    assert body["sources"]["finmind"]["id"] == "finmind"

    resolved = client.get("/api/datasources/resolve/dividend.policy")
    assert resolved.status_code == 200
    assert resolved.json()["order"] == ["finmind"]

    assert client.get("/api/datasources/resolve/nope").status_code == 404
