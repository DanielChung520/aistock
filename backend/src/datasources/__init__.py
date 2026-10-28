"""資料源註冊表（規格 `.docs/datasources/SCHEMA.md`）。"""
from __future__ import annotations

from src.datasources.registry import datasets, registry_dir, reload, resolve, sources

__all__ = ["datasets", "registry_dir", "reload", "resolve", "sources"]
