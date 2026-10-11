"""ArangoDB-backed implementations of the training ports (``src.ports``).

These are the aistock-specific adapters: they know about ArangoDB collections
and query syntax. The training pipeline in ``src.tasks.ai_training`` never
touches them directly — it only sees the ``FeatureLoader`` / ``JobStore``
protocols, so a standalone deployment can replace this module wholesale.
"""
from __future__ import annotations

import logging
import time

from arango.exceptions import ArangoError

from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

JOBS_COLLECTION = "ai_training_jobs"
FEATURES_COLLECTION = "stock_daily_features"


class ArangoFeatureLoader:
    """Reads ``stock_daily_features`` rows for the training universe."""

    def load_features(self, stock_ids: list[str], start: str, end: str) -> list[dict]:
        if not stock_ids:
            return []
        cursor = get_db().aql.execute(
            f"""
            FOR d IN {FEATURES_COLLECTION}
            FILTER d.stock_id IN @sids AND d.date >= @start AND d.date <= @end
            RETURN d
            """,
            bind_vars={"sids": stock_ids, "start": start, "end": end},
        )
        return [dict(r) for r in cursor]


class ArangoJobStore:
    """Persists ``ai_training_jobs`` docs with write-conflict retry."""

    def __init__(self) -> None:
        ensure_collection(JOBS_COLLECTION)

    def get(self, job_id: str) -> dict | None:
        return get_db().collection(JOBS_COLLECTION).get(job_id)

    def update(self, job_id: str, fields: dict) -> None:
        col = get_db().collection(JOBS_COLLECTION)
        for attempt in range(5):
            try:
                col.update({"_key": job_id, **fields})
                return
            except ArangoError:
                if attempt == 4:
                    raise
                time.sleep(0.2 * (attempt + 1))

    def stop_requested(self, job_id: str) -> bool:
        doc = self.get(job_id)
        return bool(doc and doc.get("stop_requested"))