from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.db import ensure_collection, ensure_database
from src.routers.auction import router as auction_router
from src.routers.basics import router as basics_router
from src.routers.market import router as market_router
from src.routers.stocks import router as stocks_router
from src.routers.watchlist import router as watchlist_router
from src.routers.news import router as news_router

app = FastAPI(title="aiStock Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000", "http://localhost:3300"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event() -> None:
    ensure_database()
    ensure_collection("stock_codes")
    ensure_collection("watchlist")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(stocks_router, prefix="/api")
app.include_router(news_router, prefix="/api")
app.include_router(watchlist_router, prefix="/api")
app.include_router(market_router, prefix="/api")
app.include_router(basics_router, prefix="/api")
app.include_router(auction_router, prefix="/api")
