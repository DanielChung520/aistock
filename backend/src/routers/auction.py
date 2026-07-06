from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/auction", tags=["auction"])

_CACHE_TTL_SECONDS = 3600
_USER_AGENT = "Mozilla/5.0 (aiStock/1.0)"

_years_cache: dict[str, object] = {
    "cached_at": 0.0,
    "updated_at": "",
    "data": {},
}

_auction_cache: dict[str, dict[str, object]] = {}

FIELD_MAPPING: dict[str, str] = {
    "序號": "sequence",
    "開標日期": "opening_date",
    "證券名稱": "security_name",
    "證券代號": "security_code",
    "發行市場": "market",
    "發行性質": "issue_type",
    "競拍方式": "auction_method",
    "投標開始日": "bid_start_date",
    "投標結束日": "bid_end_date",
    "競拍數量(張)": "auction_quantity",
    "最低投標價格(元)": "min_bid_price",
    "最低每標單投標數量(張)": "min_bid_quantity",
    "最高投(得)標數量(張)": "max_bid_quantity",
    "保證金成數(%)": "deposit_ratio",
    "每一投標單投標處理費(元)": "processing_fee",
    "撥券日期(上市、上櫃日期)": "settlement_date",
    "主辦券商": "lead_broker",
    "得標總金額(元)": "total_winning_amount",
    "得標手續費率(%)": "winning_fee_rate",
    "總合格件": "total_qualified",
    "合格投標數量(張)": "qualified_bid_quantity",
    "最低得標價格(元)": "min_winning_price",
    "最高得標價格(元)": "max_winning_price",
    "得標加權平均價格(元)": "weighted_avg_price",
    "實際承銷價格(元)": "actual_underwriting_price",
    "取消競價拍賣(流標或取消)": "cancelled",
}

NUMERIC_FIELDS = {
    "auction_quantity",
    "min_bid_price",
    "min_bid_quantity",
    "max_bid_quantity",
    "deposit_ratio",
    "processing_fee",
    "total_winning_amount",
    "winning_fee_rate",
    "total_qualified",
    "qualified_bid_quantity",
    "min_winning_price",
    "max_winning_price",
    "weighted_avg_price",
    "actual_underwriting_price",
}

DATE_FIELDS = {
    "opening_date",
    "bid_start_date",
    "bid_end_date",
    "settlement_date",
}


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_cache_valid(cached_at: float) -> bool:
    return (datetime.now(timezone.utc).timestamp() - cached_at) < _CACHE_TTL_SECONDS


def _to_iso_date(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    parts = text.split("/")
    if len(parts) != 3:
        return text
    try:
        year = int(parts[0])
        month = int(parts[1])
        day = int(parts[2])
    except ValueError:
        return text
    return f"{year:04d}-{month:02d}-{day:02d}"


def _clean_numeric(value: str) -> str:
    return value.replace(",", "").strip()


@router.get("/years", response_model=None)
async def get_auction_years() -> dict[str, object] | JSONResponse:
    cached_at_raw = _years_cache.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0
    if _is_cache_valid(cached_at):
        cached_data = _years_cache.get("data", {})
        if isinstance(cached_data, dict):
            return {
                "data": cached_data,
                "total": len(cached_data),
                "updated_at": _years_cache.get("updated_at", ""),
            }

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            response = await client.get(
                "https://www.twse.com.tw/rwd/zh/announcement/auctionYear",
                headers={
                    "User-Agent": _USER_AGENT,
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        return JSONResponse(
            status_code=502,
            content={
                "data": {},
                "total": 0,
                "updated_at": _now_utc_iso(),
                "error": str(exc),
            },
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=502,
            content={
                "data": {},
                "total": 0,
                "updated_at": _now_utc_iso(),
                "error": "TWSE 回傳格式錯誤",
            },
        )

    updated_at = _now_utc_iso()
    _years_cache["data"] = payload
    _years_cache["updated_at"] = updated_at
    _years_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    return {
        "data": payload,
        "total": len(payload),
        "updated_at": updated_at,
    }


@router.get("/announcements", response_model=None)
async def get_auction_announcements(year: str | None = Query(default=None)) -> dict[str, object] | JSONResponse:
    target_year = year.strip() if isinstance(year, str) and year.strip() else str(datetime.now().year)

    cache_entry = _auction_cache.get(target_year, {})
    cached_at_raw = cache_entry.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0
    if _is_cache_valid(cached_at):
        data = cache_entry.get("data", [])
        if isinstance(data, list):
            return {
                "data": data,
                "total": cache_entry.get("total", len(data)),
                "year": target_year,
                "updated_at": cache_entry.get("updated_at", ""),
                "title": cache_entry.get("title", ""),
            }

    try:
        async with httpx.AsyncClient(timeout=20.0, verify=False) as client:
            response = await client.get(
                f"https://www.twse.com.tw/rwd/zh/announcement/auction?date={target_year}",
                headers={
                    "User-Agent": _USER_AGENT,
                    "Accept": "application/json",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        return JSONResponse(
            status_code=502,
            content={
                "data": [],
                "total": 0,
                "year": target_year,
                "updated_at": _now_utc_iso(),
                "title": "",
                "error": str(exc),
            },
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=502,
            content={
                "data": [],
                "total": 0,
                "year": target_year,
                "updated_at": _now_utc_iso(),
                "title": "",
                "error": "TWSE 回傳格式錯誤",
            },
        )

    fields = payload.get("fields")
    rows = payload.get("data")
    if str(payload.get("stat", "")).lower() != "ok" or not isinstance(fields, list) or not isinstance(
        rows, list
    ):
        return {
            "data": [],
            "total": 0,
            "year": target_year,
            "updated_at": _now_utc_iso(),
            "title": str(payload.get("title", "")),
        }

    mapped_fields = [FIELD_MAPPING.get(str(field).strip(), str(field).strip()) for field in fields]
    announcements: list[dict[str, str]] = []

    for row in rows:
        if not isinstance(row, list):
            continue
        item: dict[str, str] = {}
        for index, mapped_field in enumerate(mapped_fields):
            raw_value = str(row[index]).strip() if index < len(row) else ""
            if mapped_field in NUMERIC_FIELDS:
                item[mapped_field] = _clean_numeric(raw_value)
            elif mapped_field in DATE_FIELDS:
                item[mapped_field] = _to_iso_date(raw_value)
            else:
                item[mapped_field] = raw_value
        announcements.append(item)

    title = str(payload.get("title", ""))
    total_raw = payload.get("total", len(announcements))
    try:
        total = int(str(total_raw).replace(",", ""))
    except ValueError:
        total = len(announcements)

    updated_at = _now_utc_iso()
    _auction_cache[target_year] = {
        "cached_at": datetime.now(timezone.utc).timestamp(),
        "updated_at": updated_at,
        "title": title,
        "total": total,
        "data": announcements,
    }

    return {
        "data": announcements,
        "total": total,
        "year": target_year,
        "updated_at": updated_at,
        "title": title,
    }
