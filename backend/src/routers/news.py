"""News endpoints - using FinMind TaiwanStockNews dataset"""
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query
import httpx
from src.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/news", tags=["news"])

FINMIND_API = "https://api.finmind.com.tw/v4/data"

# Mock news for fallback / development
MOCK_NEWS = [
    {
        "symbol": "2330",
        "stock_name": "台積電",
        "title": "台積電 Q2 法說會重點：3奈米需求超預期",
        "summary": "台積電第二季合併營收達新台幣 6,735 億元，3奈米製程出貨占比提升至 15%，AI 晶片需求帶動下，全年資本支出維持 320 億美元不變。",
        "source": "工商時報",
        "url": "https://www.ctee.com.tw/news/2026/07/06/tsmc-q2",
        "published_at": "2026-07-06T08:00:00Z",
    },
    {
        "symbol": "2454",
        "stock_name": "聯發科",
        "title": "聯發科天璣 9400 將採用台積電 3奈米製程",
        "summary": "聯發科新一代旗艦處理器天璣 9400 將於下半年發表，採用台積電 3奈米製程，效能較前代提升 25%，功耗降低 20%。",
        "source": "經濟日報",
        "url": "https://money.udn.com/news/story/12345",
        "published_at": "2026-07-06T07:30:00Z",
    },
    {
        "symbol": "2317",
        "stock_name": "鴻海",
        "title": "鴻海與輝達合作 AI 工廠計畫細節曝光",
        "summary": "鴻海董事長劉揚偉透露與輝達合作的 AI 工廠計畫，將在墨西哥、台灣、高雄三地建置 GB200 伺服器產線，預計 Q4 量產。",
        "source": "數位時代",
        "url": "https://www.bnext.com.tw/article/12345",
        "published_at": "2026-07-06T06:45:00Z",
    },
    {
        "symbol": "2330",
        "stock_name": "台積電",
        "title": "台積電高雄廠進度更新：2奈米廠房提前完工",
        "summary": "台積電高雄 2奈米廠房預計 2025 年 Q2 開始裝機，比原訂時程提前半年，將可承接更多高效能運算訂單。",
        "source": "中央社",
        "url": "https://www.cna.com.tw/news/afe/20260706001.aspx",
        "published_at": "2026-07-06T05:00:00Z",
    },
    {
        "symbol": "2454",
        "stock_name": "聯發科",
        "title": "聯發科 6月合併營收創歷史同期新高",
        "summary": "聯發科 6月合併營收為新台幣 502.8 億元，年增 19.3%，創歷史同期新高，主要受惠於智慧型手機與網通產品出貨暢旺。",
        "source": "時報資訊",
        "url": "https://www.chinatimes.com/realtimenews/20260706001",
        "published_at": "2026-07-06T04:00:00Z",
    },
]


@router.get("/today")
async def get_today_news(
    symbols: str = Query(default="", description="Comma-separated stock IDs")
):
    """Fetch today's news for the given stock symbols (or all if empty)."""
    settings = get_settings()
    symbol_list = [s.strip() for s in symbols.split(",") if s.strip()] if symbols else []
    today = datetime.now().strftime("%Y-%m-%d")

    news_list = []
    if settings.FINMIND_TOKEN:
        try:
            for sym in symbol_list or ["2330", "2454", "2317"]:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        FINMIND_API,
                        params={
                            "dataset": "TaiwanStockNews",
                            "data_id": sym,
                            "start_date": today,
                            "end_date": today,
                            "token": settings.FINMIND_TOKEN,
                        },
                    )
                    if resp.status_code == 200:
                        items = resp.json().get("data", [])
                        for it in items:
                            news_list.append({
                                "symbol": sym,
                                "stock_name": it.get("stock_name", sym),
                                "title": it.get("title", ""),
                                "summary": it.get("content", "")[:200],
                                "source": it.get("source", ""),
                                "url": it.get("url", ""),
                                "published_at": f"{it.get('date', today)}T08:00:00Z",
                            })
        except Exception as e:
            logger.warning(f"FinMind news fetch failed: {e}")

    # Fallback to mock if no live data
    if not news_list:
        if symbol_list:
            news_list = [n for n in MOCK_NEWS if n["symbol"] in symbol_list]
        else:
            news_list = list(MOCK_NEWS)

    # Sort newest first
    news_list.sort(key=lambda x: x.get("published_at", ""), reverse=True)

    return {
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "news": news_list,
        "symbols": symbol_list,
        "source": "finmind" if settings.FINMIND_TOKEN and news_list else "mock",
    }
