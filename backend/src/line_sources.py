"""Registry of LINE notification sources.

Each feature that can send LINE messages registers its source here; recipient
management then authorizes who receives each source. Adding a source is a single
entry — the recipient permission matrix and the send filter pick it up automatically.
"""

from __future__ import annotations

LINE_SOURCES: tuple[dict[str, str], ...] = (
    {"key": "strategy", "label": "策略執行結果"},
    {"key": "workstation2", "label": "工作站2"},
    {"key": "workstation3", "label": "工作站3"},
    {"key": "other", "label": "其他通知"},
)

_SOURCE_KEYS = {source["key"] for source in LINE_SOURCES}


def is_known_source(key: str) -> bool:
    return key in _SOURCE_KEYS


def source_keys() -> list[str]:
    return [source["key"] for source in LINE_SOURCES]
