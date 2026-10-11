import logging
from datetime import datetime, timezone

from src.celery_app import celery_app
from src.data_fetcher import fetch_minute_history, fetch_volume_profile
from src.db import get_db

logger = logging.getLogger(__name__)

WATCHLIST_JOBS_COLLECTION = "watchlist_jobs"


def _update_job_start(stock_id: str) -> None:
    """Mark the watchlist_jobs document as running on first task execution."""
    db = get_db()
    now = datetime.now(timezone.utc).timestamp()
    db.aql.execute(
        """
        UPSERT { _key: @stock_id }
        INSERT {
            _key: @stock_id,
            stock_id: @stock_id,
            status: "running",
            progress: 0,
            total_days: 0,
            done_days: 0,
            started_at: @now,
            completed_at: null,
            error: ""
        }
        UPDATE {
            status: "running",
            started_at: OLD.started_at || @now
        }
        IN watchlist_jobs
        """,
        bind_vars={"stock_id": stock_id, "now": now},
    )


def _update_job_progress(stock_id: str) -> None:
    """Increment done_days and recalculate progress for the stock job."""
    db = get_db()
    now = datetime.now(timezone.utc).timestamp()
    cursor = db.aql.execute(
        """
        UPSERT { _key: @stock_id }
        INSERT {
            _key: @stock_id,
            stock_id: @stock_id,
            status: "running",
            progress: 0,
            total_days: 0,
            done_days: 1,
            started_at: @now,
            completed_at: null,
            error: ""
        }
        UPDATE {
            done_days: OLD.done_days + 1,
            progress: OLD.total_days > 0
                ? FLOOR((OLD.done_days + 1) * 100 / OLD.total_days)
                : 0,
            status: OLD.total_days > 0 AND (OLD.done_days + 1) >= OLD.total_days
                ? "done"
                : "running",
            completed_at: OLD.total_days > 0 AND (OLD.done_days + 1) >= OLD.total_days
                ? @now
                : OLD.completed_at
        }
        IN watchlist_jobs
        """,
        bind_vars={"stock_id": stock_id, "now": now},
    )
    list(cursor)  # force execution


def _update_job_error(stock_id: str, error_msg: str) -> None:
    """Mark the job as failed with an error message."""
    db = get_db()
    now = datetime.now(timezone.utc).timestamp()
    db.aql.execute(
        """
        UPSERT { _key: @stock_id }
        INSERT {
            _key: @stock_id,
            stock_id: @stock_id,
            status: "failed",
            progress: 0,
            total_days: 0,
            done_days: 0,
            started_at: @now,
            completed_at: @now,
            error: @error_msg
        }
        UPDATE {
            status: "failed",
            error: @error_msg,
            completed_at: @now
        }
        IN watchlist_jobs
        """,
        bind_vars={"stock_id": stock_id, "error_msg": error_msg, "now": now},
    )


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def calc_volume_profile(
    self,
    stock_id: str,
    date_str: str = "",
    days: int = 1,
) -> dict:
    """
    Celery task: compute and store volume profile for a stock.

    When date_str is empty, computes for the last `days` trading days.
    When date_str is set, computes for that specific date.
    """
    logger.info(
        "calc_volume_profile started: stock_id=%s, date=%s, days=%d",
        stock_id, date_str, days,
    )

    try:
        _update_job_start(stock_id)

        # Ensure minute data is available (5m gives up to 60 days from yfinance)
        fetch_minute_history(stock_id, interval="5m", days=max(days, 60))

        if date_str:
            # Single date
            result = fetch_volume_profile(stock_id, date_str)
            _update_job_progress(stock_id)
            return result

        # Batch: determine trading dates from history
        from datetime import date, timedelta
        from src.data_fetcher import fetch_daily_history

        daily = fetch_daily_history(stock_id, months=days)
        trading_dates = [d["date"] for d in daily][-days:]

        db = get_db()
        total = len(trading_dates)
        # Initialize total_days
        db.aql.execute(
            "UPSERT { _key: @key } INSERT { _key: @key, stock_id: @key, status: 'running', total_days: @total, done_days: 0 } "
            "UPDATE { total_days: @total } IN watchlist_jobs",
            bind_vars={"key": stock_id, "total": total},
        )

        for i, dt in enumerate(trading_dates):
            try:
                fetch_volume_profile(stock_id, dt)
                done = i + 1
                progress = int(done * 100 / total)
                status = "done" if done >= total else "running"
                db.aql.execute(
                    "UPSERT { _key: @key } INSERT { _key: @key, status: @status, progress: @progress, done_days: @done, total_days: @total, completed_at: @now } "
                    "UPDATE { status: @status, progress: @progress, done_days: @done, completed_at: @now } IN watchlist_jobs",
                    bind_vars={"key": stock_id, "status": status, "progress": progress, "done": done, "total": total, "now": datetime.now(timezone.utc).timestamp()},
                )
            except Exception as exc:
                logger.warning("Failed date=%s for %s: %s", dt, stock_id, exc)
                continue

        logger.info("calc_volume_profile done: stock_id=%s, %d/%d dates", stock_id, total, total)
        return {"stock_id": stock_id, "total": total, "status": "done"}

    except Exception as exc:
        logger.error("calc_volume_profile failed: stock_id=%s, error=%s", stock_id, exc)
        _update_job_error(stock_id, str(exc))
        try:
            raise self.retry(exc=exc)
        except Exception:
            return {"error": str(exc), "stock_id": stock_id}


@celery_app.task
def calc_watchlist_all():
    from src.db import get_db
    db = get_db()
    cursor = db.aql.execute("FOR w IN watchlist RETURN w.stock_id")
    for doc in cursor:
        calc_volume_profile.delay(stock_id=doc, date_str="", days=50)
