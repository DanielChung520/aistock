"""Training pipeline ports — the I/O boundaries the orchestration core depends on.

The Celery task (``src.tasks.ai_training``) depends only on these protocols,
never on ArangoDB/Celery directly. aistock ships ArangoDB-backed adapters in
``src.adapters``; a standalone deployment swaps in different implementations
(any FeatureLoader / JobStore pair) without touching the training logic.
"""
from __future__ import annotations

from typing import Protocol


class FeatureLoader(Protocol):
    """Reads the feature rows a training run consumes."""

    def load_features(self, stock_ids: list[str], start: str, end: str) -> list[dict]:
        """Return stock_daily_features rows for the universe + date window."""
        ...


class JobStore(Protocol):
    """Persists and reads a training job's state."""

    def get(self, job_id: str) -> dict | None:
        """Return the job doc (or None when it does not exist)."""
        ...

    def update(self, job_id: str, fields: dict) -> None:
        """Merge fields into the job doc (with conflict retry)."""
        ...

    def stop_requested(self, job_id: str) -> bool:
        """True when the user asked the run to stop gracefully."""
        ...