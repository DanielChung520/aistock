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

_apply_listing_cache: dict[str, object] = {
    "cached_at": 0.0,
    "updated_at": "",
    "data": [],
}

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
    if year < 200:
        year += 1911
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


APPLY_LISTING_FIELD_MAPPING: dict[str, str] = {
    "索引": "sequence",
    "公司代號": "company_code",
    "公司簡稱": "company_name",
    "申請日期": "application_date",
    "董事長": "chairman",
    "申請時股本(仟元)": "capital_at_application",
    "上市審議委員會審議日期": "review_meeting_date",
    "交易所董事會通過上市日期": "board_approval_date",
    "上市契約報請主管機關備查(主管機關核准)日期": "contract_filing_date",
    "股票上市買賣日期": "listing_date",
    "承銷商": "lead_broker",
    "承銷價": "underwriting_price",
    "備註": "notes",
}

APPLY_LISTING_DATE_FIELDS = {
    "application_date",
    "review_meeting_date",
    "board_approval_date",
    "contract_filing_date",
    "listing_date",
}

APPLY_LISTING_NUMERIC_FIELDS = {
    "capital_at_application",
    "underwriting_price",
}


def _infer_apply_listing_category(notes: str, company_name: str) -> str:
    if "創新板" in notes or "-創" in company_name:
        return "TIB"
    if "KY" in company_name or "第一上市" in notes:
        return "Foreign"
    return "Local"


def _extract_ad_year(iso_date: str) -> int:
    if not iso_date or len(iso_date) < 4:
        return 0
    try:
        return int(iso_date[:4])
    except ValueError:
        return 0


def _fetch_apply_listing_all() -> list[dict[str, object]]:
    upstream_url = "https://www.twse.com.tw/rwd/zh/company/applylisting"
    with httpx.Client(timeout=30.0, verify=False) as client:
        response = client.get(
            upstream_url,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict) or str(payload.get("stat", "")).lower() != "ok":
        raise ValueError("TWSE 回傳狀態非 ok")

    fields = payload.get("fields")
    rows = payload.get("data")
    if not isinstance(fields, list) or not isinstance(rows, list):
        raise ValueError("TWSE 回傳格式錯誤")

    mapped_fields = [
        APPLY_LISTING_FIELD_MAPPING.get(str(field).strip(), str(field).strip())
        for field in fields
    ]

    items: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, list):
            continue
        item: dict[str, object] = {}
        for index, mapped_field in enumerate(mapped_fields):
            raw_value = str(row[index]).strip() if index < len(row) else ""
            if mapped_field in APPLY_LISTING_NUMERIC_FIELDS:
                item[mapped_field] = _clean_numeric(raw_value)
            elif mapped_field in APPLY_LISTING_DATE_FIELDS:
                item[mapped_field] = _to_iso_date(raw_value)
            else:
                item[mapped_field] = raw_value
        notes = str(item.get("notes", ""))
        company_name = str(item.get("company_name", ""))
        item["category"] = _infer_apply_listing_category(notes, company_name)
        application_date = str(item.get("application_date", ""))
        item["application_year"] = _extract_ad_year(application_date)
        items.append(item)

    return items


@router.get("/apply-listing", response_model=None)
async def get_apply_listing(
    type: str | None = Query(default=None),
) -> dict[str, object] | JSONResponse:
    """已申請上市公司列表 (TWSE apply-listing 公開資料).

    對應 TWSE 頁面: https://www.twse.com.tw/zh/listed/listed/apply-listing.html
    與 apply-listing.html 同步，但前端可加上「我的關注」欄位 (localStorage)。
    """
    cached_at_raw = _apply_listing_cache.get("cached_at", 0.0)
    cached_at = (
        float(cached_at_raw)
        if isinstance(cached_at_raw, int | float | str)
        else 0.0
    )

    all_items: list[dict[str, object]]
    if _is_cache_valid(cached_at):
        cached_data = _apply_listing_cache.get("data", [])
        all_items = cached_data if isinstance(cached_data, list) else []
    else:
        try:
            all_items = _fetch_apply_listing_all()
        except (httpx.HTTPError, ValueError) as exc:
            return JSONResponse(
                status_code=502,
                content={
                    "data": [],
                    "total": 0,
                    "updated_at": _now_utc_iso(),
                    "error": str(exc),
                },
            )

        _apply_listing_cache["data"] = all_items
        _apply_listing_cache["updated_at"] = _now_utc_iso()
        _apply_listing_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    filtered: list[dict[str, object]] = list(all_items)
    type_value = "All"
    if isinstance(type, str) and type.strip():
        normalized = type.strip()
        if normalized in ("Local", "Foreign", "TIB"):
            filtered = [item for item in filtered if item.get("category") == normalized]
            type_value = normalized

    updated_at_value = _apply_listing_cache.get("updated_at", "")
    return {
        "data": filtered,
        "total": len(filtered),
        "type": type_value,
        "updated_at": updated_at_value,
        "title": "申請上市公司",
    }
