"""資料源註冊表載入與來源解析（唯讀）。規格：`.docs/datasources/SCHEMA.md`。

JSON 為真相來源：`datasets.json` 定義正規資料集與各來源優先序，`{source}.json`
描述來源能力。本模組只讀（不抓資料），供 router 與（未來）`data_fetcher` 決定
「某資料集該用哪個來源、備援順序如何」。
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DIR = _REPO_ROOT / ".docs" / "datasources"


def registry_dir() -> Path:
    return Path(os.environ.get("DATASOURCES_DIR", str(DEFAULT_DIR)))


@lru_cache(maxsize=1)
def _load() -> tuple[dict, dict[str, dict]]:
    base = registry_dir()
    datasets = json.loads((base / "datasets.json").read_text(encoding="utf-8"))["datasets"]
    sources: dict[str, dict] = {}
    for path in sorted(base.glob("*.json")):
        if path.name == "datasets.json":
            continue
        source = json.loads(path.read_text(encoding="utf-8"))
        sources[source["id"]] = source
    return datasets, sources


def reload() -> None:
    _load.cache_clear()


def datasets() -> dict:
    return _load()[0]


def sources() -> dict[str, dict]:
    return _load()[1]


def resolve(dataset_id: str, *, include_planned: bool = False) -> list[str]:
    """Return source ids for a dataset, ordered by priority (lowest first).

    Planned sources are skipped unless ``include_planned`` is set.
    Raises KeyError when the dataset id is not in the vocabulary.
    """
    dataset = datasets().get(dataset_id)
    if dataset is None:
        raise KeyError(f"unknown dataset: {dataset_id}")
    ordered = sorted(dataset.get("sources", []), key=lambda s: s.get("priority", 999))
    return [
        entry["id"]
        for entry in ordered
        if include_planned or entry.get("status") != "planned"
    ]
