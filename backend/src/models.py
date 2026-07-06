from pydantic import BaseModel


class StockCode(BaseModel):
    stock_id: str
    name: str
    isin_code: str = ""
    market_type: str = ""
    industry: str = ""
    listed_date: str = ""


class StockDaily(BaseModel):
    stock_id: str
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    turnover: int
    change: float
    transaction: int


class WatchlistItem(BaseModel):
    stock_id: str
    name: str
    added_at: str


class WatchlistAddRequest(BaseModel):
    stock_id: str
