"""Scheduler engine for schedule_jobs: APScheduler loop + shared dispatch.

The FastAPI lifespan (src/main.py) owns start/stop; this module keeps the
collection seeding, the shared execute_job() dispatch and the APScheduler
registration in one place so the schedule router can reuse them without
circular imports. All scheduled executions update the job document with
last_run / last_status so failures never kill the scheduler.
"""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from src.db import ensure_collection, get_db

logger = logging.getLogger(__name__)

SCHEDULE_COLLECTION = "schedule_jobs"
SCHEDULER_TIMEZONE = "Asia/Taipei"

PREDEFINED_JOBS = {
    "research_ohlcv": {
        "name": "研究資料-日K/O1C1",
        "type": "research_ohlcv",
        "description": "下載研究 universe (59檔) 的日K OHLCV 與 O1/C1（2年窗口）",
        "default_cron": "0 15 * * 1-5",
        "default_params": {},
    },
    "research_flows": {
        "name": "研究資料-法人買賣超",
        "type": "research_flows",
        "description": "下載研究 universe (59檔) 的法人買賣超",
        "default_cron": "30 15 * * 1-5",
        "default_params": {},
    },
    "research_margin": {
        "name": "研究資料-融資融券",
        "type": "research_margin",
        "description": "下載研究 universe (59檔) 的融資融券",
        "default_cron": "0 16 * * 1-5",
        "default_params": {},
    },
    "research_revenue": {
        "name": "研究資料-月營收",
        "type": "research_revenue",
        "description": "下載研究 universe (59檔) 的月營收",
        "default_cron": "30 16 * * 1-5",
        "default_params": {},
    },
    "data_download": {
        "name": "每日資料下載",
        "type": "data_download",
        "description": "下載 watchlist 所有股票的日K與分K資料",
        "default_cron": "30 14 * * 1-5",
        "default_params": {},
    },
    "vp_calculation": {
        "name": "分價圖計算",
        "type": "vp_calculation",
        "description": "為 watchlist 股票計算當日分價圖並清理超過 50 天的舊資料",
        "default_cron": "45 14 * * 1-5",
        "default_params": {"retain_days": 50},
    },
    "tech_indicators": {
        "name": "技術指標計算",
        "type": "tech_indicators",
        "description": "預先計算 watchlist 股票的常用技術指標",
        "default_cron": "0 15 * * 1-5",
        "default_params": {},
    },
    "history_cleanup": {
        "name": "歷史資料清理",
        "type": "history_cleanup",
        "description": "清理超過保留期限的分K與 VP 資料",
        "default_cron": "0 16 * * 4",
        "default_params": {"minute_retain_days": 14, "vp_retain_days": 50},
    },
    "strategy_hits_cleanup": {
        "name": "策略命中清理",
        "type": "strategy_hits_cleanup",
        "description": "刪除超過 30 天且已讀的 strategy_hits 文件",
        "default_cron": "0 17 * * 1-5",
        "default_params": {"retain_seconds": 30 * 86400},
    },
    "market_index_backfill": {
        "name": "市場指數-回補2年",
        "type": "market_index_backfill",
        "description": "回補市場指數（台/亞/美股）2年日K 至 market_index_daily",
        "default_cron": "15 15 * * 0",
        "default_params": {},
    },
    "market_index_daily": {
        "name": "市場指數-每日增量",
        "type": "market_index_daily",
        "description": "每日增量下載市場指數（功能設置指數清單）",
        "default_cron": "45 15 * * 1-5",
        "default_params": {},
    },
    "institutional_daily": {
        "name": "三大法人-每日增量",
        "type": "institutional_daily",
        "description": "全市場三大法人買賣超每日增量（TWSE T86 + TPEx，永久保存）",
        "default_cron": "30 16 * * 1-5",
        "default_params": {},
    },
    "tx_data_daily": {
        "name": "TX 期貨-每日增量",
        "type": "tx_data_daily",
        "description": "每日盤後增量下載 TX 期貨 1 分 K → 聚合成 15 分 K（需 Shioaji 認證）",
        "default_cron": "30 14 * * 1-5",
        "default_params": {"lookback_days": 7, "contracts": ["TXFR1", "TXFR2"], "bar_minutes": [1, 15]},
    },
}

_scheduler: BackgroundScheduler | None = None


# ── Collection helpers ─────────────────────────────────────────

def ensure_schedule_collection() -> None:
    """Create the schedule_jobs collection on first run (idempotent)."""
    ensure_collection(SCHEDULE_COLLECTION)


def seed_default_jobs() -> None:
    """Insert the PREDEFINED_JOBS documents when missing (idempotent)."""
    col = get_db().collection(SCHEDULE_COLLECTION)
    now = datetime.now(timezone.utc).timestamp()
    for key, cfg in PREDEFINED_JOBS.items():
        if col.has(key):
            continue
        col.insert({
            "_key": key,
            "type": cfg["type"],
            "name": cfg["name"],
            "description": cfg["description"],
            "enabled": True,
            "cron": cfg["default_cron"],
            "params": cfg["default_params"],
            "last_run": None,
            "last_status": None,
            "created_at": now,
            "updated_at": now,
        })


# ── Shared dispatch ────────────────────────────────────────────

def execute_job(job: dict) -> int | None:
    """Dispatch a schedule_jobs document to its implementation.

    Returns the deleted-record count for history_cleanup, None otherwise.
    Raises ValueError for unknown job types (the router maps it to HTTP 400).
    """
    job_type = job.get("type")
    params = job.get("params") or {}

    if job_type in ("data_download", "vp_calculation"):
        from src.tasks.calc_volume_profile import calc_watchlist_all
        calc_watchlist_all.delay()
        return None

    if job_type in ("research_ohlcv", "research_flows", "research_margin", "research_revenue"):
        from src.tasks.research_download import research_flows, research_margin, research_ohlcv, research_revenue
        task_map = {
            "research_ohlcv": research_ohlcv,
            "research_flows": research_flows,
            "research_margin": research_margin,
            "research_revenue": research_revenue,
        }
        task_map[job_type].delay()
        return None

    if job_type in ("market_index_backfill", "market_index_daily"):
        from src.tasks.market_index_download import market_index_backfill, market_index_daily
        task_map = {
            "market_index_backfill": market_index_backfill,
            "market_index_daily": market_index_daily,
        }
        task_map[job_type].delay()
        return None

    if job_type == "tx_data_daily":
        from src.tasks.tx_data_daily import tx_data_daily_task
        tx_data_daily_task.delay(params or {})
        return None

    if job_type == "institutional_daily":
        from src.tasks.institutional_daily import institutional_daily
        institutional_daily.delay()
        return None

    if job_type == "tech_indicators":
        from src.tasks.precompute_indicators import precompute_watchlist_indicators
        precompute_watchlist_indicators.delay()
        return None

    if job_type == "history_cleanup":
        from src.data_fetcher import purge_old_minute_data
        retain_days = int(params.get("minute_retain_days") or 14)
        return purge_old_minute_data(retain_days=retain_days)

    if job_type == "strategy_hits_cleanup":
        from src.tasks.strategy_hit_cleanup import cleanup_expired_hits
        retain = int(params.get("retain_seconds") or 30 * 86400)
        return cleanup_expired_hits(retain_seconds=retain)

    if job_type == "strategy_screen":
        from src.routers.strategy import run_strategy
        strategy_id = str(params.get("strategy_id") or "")
        if not strategy_id:
            raise ValueError("strategy_screen job requires params.strategy_id")
        run_strategy(strategy_id, scope=str(params.get("scope") or "all"), source="scheduled")
        return None

    raise ValueError(f"unknown job type: {job_type}")


def _record_run(key: str, status: str) -> None:
    """Persist last_run / last_status / updated_at onto the job document."""
    db = get_db()
    now = datetime.now(timezone.utc).timestamp()
    db.collection(SCHEDULE_COLLECTION).update(
        {"_key": key, "last_run": now, "last_status": status, "updated_at": now}
    )


def _job_runner(key: str, job: dict) -> None:
    """APScheduler callback: run the job and record its outcome.

    A failing job is logged and recorded as "error: <msg>" — it never
    propagates, so the scheduler keeps ticking.
    """
    try:
        execute_job(job)
    except Exception as exc:
        logger.error("Scheduled job %s failed: %s", key, exc)
        _record_run(key, f"error: {exc}")
        return
    _record_run(key, "success")
    logger.info("Scheduled job %s completed", key)


# ── Scheduler lifecycle ────────────────────────────────────────

def _register_job(key: str, job: dict) -> None:
    """Register one enabled job onto the APScheduler instance."""
    cron = job.get("cron") or ""
    try:
        trigger = CronTrigger.from_crontab(cron, timezone=SCHEDULER_TIMEZONE)
    except ValueError:
        logger.error("Skipping job %s: malformed cron %r", key, cron)
        return
    if _scheduler is None:
        return
    _scheduler.add_job(
        _job_runner,
        trigger,
        args=[key, job],
        id=f"schedule_{key}",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
    )


def start_scheduler() -> None:
    """Seed schedule_jobs and load all enabled jobs into the scheduler.

    Idempotent: no-ops when the scheduler is already running.
    """
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        logger.info("Scheduler already running, skipping start")
        return

    ensure_schedule_collection()
    seed_default_jobs()

    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone=SCHEDULER_TIMEZONE)
    _scheduler.remove_all_jobs()

    cursor = get_db().aql.execute(
        "FOR j IN schedule_jobs FILTER j.enabled == true RETURN j"
    )
    for job in cursor:
        _register_job(job["_key"], job)

    _scheduler.start()
    logger.info("Scheduler started with %d job(s)", len(_scheduler.get_jobs()))


def stop_scheduler() -> None:
    """Stop the background scheduler if it is running."""
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def sync_job(key: str) -> None:
    """Hot-reload a single job after an update (or delete).

    Removes the old APScheduler job (id schedule_<key>) before re-adding it;
    jobs that are disabled or deleted are removed and not re-registered.
    """
    if _scheduler is None or not _scheduler.running:
        return

    job_id = f"schedule_{key}"
    if _scheduler.get_job(job_id) is not None:
        _scheduler.remove_job(job_id)

    col = get_db().collection(SCHEDULE_COLLECTION)
    if not col.has(key):
        logger.info("Job %s deleted; removed from scheduler", key)
        return
    job = col.get(key)
    if not job.get("enabled", False):
        logger.info("Job %s disabled; removed from scheduler", key)
        return
    _register_job(key, job)
    logger.info("Job %s re-registered in scheduler", key)
