import importlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.db import ensure_collection, ensure_database, get_db
from src.data_fetcher import DAILY_COLLECTION, MINUTE_COLLECTION, VP_COLLECTION
from src.scheduler import start_scheduler, stop_scheduler
from src.routers.auction import router as auction_router
from src.routers.backtest import router as backtest_router
from src.routers.bars import router as bars_router
from src.routers.basics import router as basics_router
from src.routers.market import router as market_router
from src.routers.schedule import router as schedule_router
from src.routers.stocks import router as stocks_router
from src.routers.strategy import router as strategy_router
from src.routers.strategy_hits import router as strategy_hits_router
from src.routers.watchlist import router as watchlist_router
from src.routers.news import router as news_router
from src.routers.patterns import router as patterns_router
from src.routers.features import router as features_router
from src.routers.ai_training import router as ai_training_router
from src.routers.tx_rl import router as tx_rl_router

logger = logging.getLogger(__name__)


def _seed_stock_codes_if_empty() -> None:
    """Populate the ArangoDB stock_codes collection from twstock on first run.

    Without this, watchlist.py and stocks.py AQL queries return 404 because
    the collection is empty. Migrating a new server also leaves the collection
    empty until this runs.
    """
    collection = get_db().collection("stock_codes")
    if collection.count() > 0:
        logger.info("stock_codes collection already populated (%d docs)", collection.count())
        return

    twstock = importlib.import_module("twstock")
    arango_exc = importlib.import_module("arango.exceptions")
    document_insert_error = getattr(arango_exc, "DocumentInsertError", None)

    def _normalize_market(stock_type: str) -> str:
        value = stock_type.lower()
        if "上櫃" in stock_type or "tpex" in value or "otc" in value:
            return "tpex"
        return "twse"

    processed = 0
    for code, info in twstock.codes.items():
        if not code.isdigit() or len(code) != 4:
            continue
        document = {
            "_key": code,
            "stock_id": code,
            "name": info.name,
            "isin_code": info.ISIN or "",
            "market_type": _normalize_market(info.type),
            "industry": info.group or "",
            "listed_date": info.start or "",
        }
        try:
            collection.insert(document, overwrite=True)
        except Exception as exc:
            if document_insert_error and isinstance(exc, document_insert_error):
                collection.replace(code, document)
            else:
                logger.warning("Failed to insert %s: %s", code, exc)
        processed += 1
    logger.info("Seeded %d stock codes from twstock", processed)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_database()
    ensure_collection("stock_codes")
    ensure_collection("watchlist")
    ensure_collection(DAILY_COLLECTION)
    ensure_collection(MINUTE_COLLECTION)
    ensure_collection(VP_COLLECTION)
    ensure_collection("watchlist_jobs")
    ensure_collection("search_patterns")
    ensure_collection("stock_daily_features")
    ensure_collection("feature_jobs")
    ensure_collection("ai_training_jobs")
    ensure_collection("model_artifacts")
    ensure_collection("strategy_hits")
    hits_col = get_db().collection("strategy_hits")
    existing = {tuple(i.get("fields", [])) for i in hits_col.indexes()}
    for fields in (["read"], ["scan_at"]):
        if tuple(fields) not in existing:
            hits_col.add_index({"type": "persistent", "fields": fields})
    _seed_stock_codes_if_empty()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="aiStock Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000", "http://localhost:3300"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(stocks_router, prefix="/api")
app.include_router(bars_router, prefix="/api")
app.include_router(schedule_router, prefix="/api")
app.include_router(news_router, prefix="/api")
app.include_router(watchlist_router, prefix="/api")
app.include_router(market_router, prefix="/api")
app.include_router(basics_router, prefix="/api")
app.include_router(auction_router, prefix="/api")
app.include_router(backtest_router, prefix="/api")
app.include_router(strategy_router, prefix="/api")
app.include_router(strategy_hits_router, prefix="/api")
app.include_router(patterns_router, prefix="/api")
app.include_router(features_router, prefix="/api")
app.include_router(ai_training_router, prefix="/api")
app.include_router(tx_rl_router, prefix="/api")
