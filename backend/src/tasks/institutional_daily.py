"""Celery tasks: whole-market 三大法人 daily download (TWSE T86 + TPEx).

Two jobs (see scheduler.py PREDEFINED_JOBS):
  1. institutional_backfill — one-shot 2y backfill (per trading day, rate-limited)
  2. institutional_daily    — daily incremental (last 10 days, idempotent)

Both iterate calendar days (weekdays only) and upsert into `institutional_daily`
with key `{stock_id}_{date}` via src.institutional. Non-trading days simply yield
no rows (TWSE returns stat != OK / empty). Data is permanent — no TTL cleanup.
"""
from __future__ import annotations

import logging
import traceback
from datetime import date, timedelta

from src.celery_app import celery_app
from src.institutional import (
    INSTITUTIONAL_COLLECTION,
    ensure_index,
    fetch_institutional,
    known_stock_ids,
    upsert_institutional,
)

logger = logging.getLogger(__name__)

BACKFILL_DAYS = 730  # 2y retention (user decision)
INCREMENT_DAYS = 10  # refetch last 10 days (covers today + holidays)


def _run_institutional(days: int) -> dict:
    """Fetch + upsert 三大法人 for every weekday in [today-days, today]."""
    from src.db import ensure_collection

    ensure_collection(INSTITUTIONAL_COLLECTION)
    ensure_index()
    known = known_stock_ids()

    end = date.today()
    start = end - timedelta(days=days)

    written = 0
    days_fetched = 0
    days_with_data = 0
    errors = 0
    # Newest → oldest: recent days land first so the screener works even if the
    # run is interrupted mid-way (history keeps filling on later runs; idempotent).
    d = end
    while d >= start:
        if d.weekday() < 5:  # Mon-Fri; holidays return no usable rows
            try:
                rows = fetch_institutional(d, known)
                if rows:
                    written += upsert_institutional(rows)
                    days_with_data += 1
                days_fetched += 1
            except Exception as exc:  # noqa: BLE001 — one day failing must not stop the run
                errors += 1
                logger.error(
                    "institutional %s failed: %s\n%s", d, exc, traceback.format_exc()
                )
        d -= timedelta(days=1)

    logger.info(
        "institutional %s..%s: days_fetched=%s days_with_data=%s written=%s errors=%s",
        start,
        end,
        days_fetched,
        days_with_data,
        written,
        errors,
    )
    return {
        "range": [start.isoformat(), end.isoformat()],
        "days_fetched": days_fetched,
        "days_with_data": days_with_data,
        "written": written,
        "errors": errors,
    }


@celery_app.task
def institutional_backfill() -> dict:
    """One-shot 2y backfill of whole-market 三大法人 (idempotent)."""
    return _run_institutional(BACKFILL_DAYS)


@celery_app.task
def institutional_daily() -> dict:
    """Daily incremental download of whole-market 三大法人 (idempotent)."""
    return _run_institutional(INCREMENT_DAYS)
