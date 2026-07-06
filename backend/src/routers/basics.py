import asyncio
import html
import re
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/basics", tags=["basics"])

_CACHE_TTL_SECONDS = 3600
_COMPANY_CACHE_TTL = 86400
_USER_AGENT = "Mozilla/5.0 (aiStock/1.0)"

_stock_codes_cache: dict[str, object] = {
    "cached_at": 0.0,
    "updated_at": "",
    "data": [],
}

_brokers_cache: dict[str, object] = {
    "cached_at": 0.0,
    "updated_at": "",
    "data": [],
}

_company_cache: dict[str, dict] = {}

_COMPANY_FIELD_LABELS: dict[str, str] = {
    "stock_code": "股票代號",
    "company_name": "公司名稱",
    "industry": "產業類別",
    "foreign_registration": "外國企業註冊地國",
    "chairman": "董事長",
    "ceo": "總經理",
    "spokesperson": "發言人",
    "spokesperson_title": "發言人職稱",
    "spokesperson_phone": "發言人電話",
    "deputy_spokesperson": "代理發言人",
    "address": "地址",
    "phone": "總機",
    "business_description": "主要經營業務",
    "established_date": "公司成立日期",
    "tax_id": "營利事業統一編號",
    "paid_in_capital": "實收資本額",
    "listing_date": "上市日期",
    "otc_date": "上櫃日期",
    "emerging_date": "興櫃日期",
    "public_offering_date": "公開發行日期",
    "par_value": "普通股每股面額",
    "shares_issued": "已發行普通股數或TDR原股發行股數",
    "preferred_shares": "特別股",
    "dividend_frequency": "普通股盈餘分派或虧損撥補頻率",
    "transfer_agent": "股票過戶機構",
    "transfer_agent_phone": "電話",
    "transfer_agent_address": "過戶地址",
    "auditor_firm": "簽證會計師事務所",
    "auditor_1": "簽證會計師1",
    "auditor_2": "簽證會計師2",
    "english_name": "英文全名",
    "english_address_street": "英文通訊地址(街巷弄號)",
    "english_address_city": "英文通訊地址(縣市國別)",
    "fax": "傳真機號碼",
    "email": "電子郵件信箱",
    "website": "公司網址",
    "investor_relations_contact": "投資人關係聯絡人",
    "investor_relations_title": "投資人關係聯絡人職稱",
    "investor_relations_phone": "投資人關係聯絡電話",
    "investor_relations_email": "投資人關係電子郵件",
}

_COMPANY_DATE_FIELDS = {
    "established_date",
    "listing_date",
    "otc_date",
    "emerging_date",
    "public_offering_date",
}


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_cache_valid(cached_at: float) -> bool:
    return (datetime.now(timezone.utc).timestamp() - cached_at) < _CACHE_TTL_SECONDS


def _clean_html_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value)
    text = html.unescape(text)
    text = text.replace("\xa0", " ").strip()
    return re.sub(r"\s+", " ", text)


def _clean_company_value(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    text = re.sub(r"\s+\n", "\n", text)
    return text.strip()


def _roc_to_iso(value: str) -> str:
    """Convert ROC date (e.g. 100/12/02) or Western date (e.g. 1962/02/09) to ISO format."""
    parts = value.strip().split("/")
    if len(parts) != 3:
        return ""
    try:
        year = int(parts[0])
        month = int(parts[1])
        day = int(parts[2])
    except ValueError:
        return ""
    if year < 1000:
        year += 1911
    return f"{year:04d}-{month:02d}-{day:02d}"


def _parse_code_and_name(raw_value: str) -> tuple[str, str]:
    text = _clean_html_text(raw_value)
    parts = text.split("\u3000", 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()

    match = re.match(r"^(\d+)\s+(.+)$", text)
    if not match:
        return "", ""
    return match.group(1).strip(), match.group(2).strip()


def _parse_stock_codes_from_html(content: str) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", content, flags=re.IGNORECASE | re.DOTALL)

    for row in rows:
        cells = re.findall(
            r"<td[^>]*bgcolor\s*=\s*[\"']?#FAFAD2[\"']?[^>]*>(.*?)</td>",
            row,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if len(cells) < 5:
            continue

        code, name = _parse_code_and_name(cells[0])
        if not (code.isdigit() and len(code) == 4):
            continue
        if code.startswith("00"):
            continue

        isin = _clean_html_text(cells[1])
        listing_date = _roc_to_iso(_clean_html_text(cells[2]))
        market = _clean_html_text(cells[3])
        industry = _clean_html_text(cells[4])

        status = "上市" if market == "上市" else "上櫃"

        result.append(
            {
                "code": code,
                "name": name,
                "isin": isin,
                "listing_date": listing_date,
                "market": market,
                "industry": industry,
                "status": status,
                "remark": "",
            }
        )

    return result


def _parse_company_info_from_html(content: str) -> dict[str, str]:
    result: dict[str, str] = {key: "" for key in _COMPANY_FIELD_LABELS}
    label_to_keys: dict[str, list[str]] = {}
    for key, label in _COMPANY_FIELD_LABELS.items():
        label_to_keys.setdefault(label, []).append(key)

    match_counts: dict[str, int] = {}
    cells = re.findall(r"<(th|td)\b[^>]*>(.*?)</\1>", content, flags=re.IGNORECASE | re.DOTALL)

    for index, (cell_type, cell_content) in enumerate(cells):
        if cell_type.lower() != "th":
            continue

        label = _clean_html_text(cell_content).strip().rstrip("：:")
        target_keys = label_to_keys.get(label)
        if not target_keys:
            continue

        value = ""
        for next_index in range(index + 1, len(cells)):
            next_type, next_content = cells[next_index]
            if next_type.lower() == "td":
                value = _clean_company_value(next_content)
                break

        label_count = match_counts.get(label, 0)
        if label_count >= len(target_keys):
            continue

        key = target_keys[label_count]
        result[key] = value
        match_counts[label] = label_count + 1

    for date_field in _COMPANY_DATE_FIELDS:
        raw_date = result.get(date_field, "")
        if not raw_date:
            continue
        converted = _roc_to_iso(raw_date)
        if converted:
            result[date_field] = converted

    return result


def _is_company_cache_valid(stock_id: str) -> bool:
    cache_entry = _company_cache.get(stock_id)
    if not cache_entry:
        return False
    cached_at = cache_entry.get("cached_at")
    if not isinstance(cached_at, float):
        return False
    return (datetime.now(timezone.utc).timestamp() - cached_at) < _COMPANY_CACHE_TTL


@router.get("/stock-codes")
async def get_stock_codes(refresh: bool = False) -> dict[str, object]:
    cached_at_raw = _stock_codes_cache.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0

    if not refresh and _is_cache_valid(cached_at):
        data = _stock_codes_cache.get("data", [])
        return {
            "data": data,
            "total": len(data) if isinstance(data, list) else 0,
            "updated_at": _stock_codes_cache.get("updated_at", ""),
        }

    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    }
    urls = [
        "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2",
        "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4",
    ]

    async def _fetch_one(client: httpx.AsyncClient, url: str) -> list[dict[str, str]]:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        html_text = resp.content.decode("big5", errors="ignore")
        return _parse_stock_codes_from_html(html_text)

    merged: list[dict[str, str]] = []
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            results = await asyncio.gather(*[_fetch_one(client, u) for u in urls])
            for stocks in results:
                merged.extend(stocks)
    except httpx.HTTPError as exc:
        return {
            "data": [],
            "total": 0,
            "updated_at": _now_utc_iso(),
            "error": str(exc),
        }

    updated_at = _now_utc_iso()
    _stock_codes_cache["data"] = merged
    _stock_codes_cache["updated_at"] = updated_at
    _stock_codes_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    return {
        "data": merged,
        "total": len(merged),
        "updated_at": updated_at,
    }


@router.get("/brokers")
async def get_brokers() -> dict[str, object]:
    cached_at_raw = _brokers_cache.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0
    if _is_cache_valid(cached_at):
        data = _brokers_cache.get("data", [])
        return {
            "data": data,
            "total": len(data) if isinstance(data, list) else 0,
            "updated_at": _brokers_cache.get("updated_at", ""),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            response = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={
                    "dataset": "TaiwanSecuritiesTraderInfo",
                },
                headers={"User-Agent": _USER_AGENT},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        return {
            "data": [],
            "total": 0,
            "updated_at": _now_utc_iso(),
            "error": str(exc),
        }

    if payload.get("status") != 200:
        return {
            "data": [],
            "total": 0,
            "updated_at": _now_utc_iso(),
        }

    raw_data = payload.get("data", [])
    if not isinstance(raw_data, list):
        return {
            "data": [],
            "total": 0,
            "updated_at": _now_utc_iso(),
        }

    brokers: list[dict[str, str]] = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        code = str(item.get("securities_trader_id", "")).strip()
        name = str(item.get("securities_trader", "")).strip()
        address = str(item.get("address", "")).strip()
        phone = str(item.get("phone", "")).strip()
        if not code or not name:
            continue
        brokers.append({
            "code": code,
            "name": name,
            "opening_date": item.get("date", ""),
            "address": address,
            "phone": phone,
        })

    updated_at = _now_utc_iso()
    _brokers_cache["data"] = brokers
    _brokers_cache["updated_at"] = updated_at
    _brokers_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    return {
        "data": brokers,
        "total": len(brokers),
        "updated_at": updated_at,
    }


@router.get("/company/{stock_id}", response_model=None)
async def get_company_info(stock_id: str) -> dict[str, str] | JSONResponse:
    normalized_stock_id = stock_id.strip()
    if _is_company_cache_valid(normalized_stock_id):
        cached = _company_cache.get(normalized_stock_id, {})
        cached_data = cached.get("data", {})
        if isinstance(cached_data, dict):
            return cached_data

    form_body = (
        "encodeURIComponent=1&step=1&firstin=1&off=1"
        f"&co_id={normalized_stock_id}&TYPEK=all"
    )
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            response = await client.post(
                "https://mopsov.twse.com.tw/mops/web/ajax_t05st03",
                content=form_body,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": _USER_AGENT,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=502,
            content={"error": f"取得公司資料失敗: {str(exc)}", "stock_code": normalized_stock_id},
        )

    html_text = response.content.decode("utf-8", errors="ignore")
    company_data = _parse_company_info_from_html(html_text)

    has_data = any(
        value for key, value in company_data.items() if key != "stock_code" and isinstance(value, str)
    )
    if not has_data:
        return JSONResponse(
            status_code=404,
            content={"error": "查無此公司資料", "stock_code": normalized_stock_id},
        )

    company_data["stock_code"] = company_data.get("stock_code") or normalized_stock_id
    company_data["updated_at"] = _now_utc_iso()

    _company_cache[normalized_stock_id] = {
        "cached_at": datetime.now(timezone.utc).timestamp(),
        "data": company_data,
    }

    return company_data


_institutional_cache: dict[str, object] = {
    "cached_at": 0.0,
    "data": [],
    "latest_date": "",
}


_INSTITUTIONAL_NAMES: dict[str, str] = {
    "Foreign_Investor": "外國投資者",
    "Investment_Trust": "投信",
    "Dealer_self": "自營商(自行)",
    "Dealer_Hedging": "自營商(避險)",
    "Foreign_Dealer_Self": "外國自營商",
    "Total": "合計",
}


@router.get("/institutional")
async def get_institutional() -> dict[str, object]:
    """取得三大法人每日買賣超總計（From FinMind, free tier)."""
    cached_at_raw = _institutional_cache.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0
    if _is_cache_valid(cached_at):
        return {
            "data": _institutional_cache.get("data", []),
            "latest_date": _institutional_cache.get("latest_date", ""),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            # FinMind free tier dataset: TaiwanStockTotalInstitutionalInvestors
            resp = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={
                    "dataset": "TaiwanStockTotalInstitutionalInvestors",
                    "start_date": "2025-01-01",  # fetch year to date
                    "end_date": "2030-12-31",
                },
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as exc:
        return {
            "data": [],
            "latest_date": "",
            "error": f"FinMind API 失敗: {str(exc)}",
        }

    if payload.get("status") != 200:
        return {
            "data": [],
            "latest_date": "",
            "error": payload.get("msg", "Unknown error"),
        }

    raw_data = payload.get("data", [])
    if not isinstance(raw_data, list):
        return {"data": [], "latest_date": "", "error": "Invalid data format"}

    # Normalize and translate
    rows = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", ""))
        translated_name = _INSTITUTIONAL_NAMES.get(name, name)
        rows.append({
            "date": item.get("date", ""),
            "name": translated_name,
            "nameKey": name,
            "buy": int(item.get("buy", 0) or 0),
            "sell": int(item.get("sell", 0) or 0),
            "net": int(item.get("buy", 0) or 0) - int(item.get("sell", 0) or 0),
        })

    # Find the latest date with data
    latest_date = ""
    if rows:
        dates_with_data = sorted(set(r["date"] for r in rows if r["date"]), reverse=True)
        if dates_with_data:
            latest_date = dates_with_data[0]

    _institutional_cache["data"] = rows
    _institutional_cache["latest_date"] = latest_date
    _institutional_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    return {
        "data": rows,
        "latest_date": latest_date,
    }


_entities_cache: dict[str, object] = {
    "cached_at": 0.0,
    "dealers": [],
    "foreign_brokers": [],
    "investment_trusts": [],
}


_FOREIGN_KEYWORDS = [
    "美林", "摩根大通", "摩根士丹利", "高盛", "野村", "花旗",
    "瑞銀", "麥格理", "匯豐", "瑞士信貸", "德意志",
    "港商", "新加坡商", "美商", "外商",
]


def _classify_broker(name: str, business_types: str) -> str | None:
    name_lower = name.lower()
    for kw in _FOREIGN_KEYWORDS:
        if kw in name:
            return "foreign_broker"
    if "自營" in business_types:
        return "dealer"
    return None


@router.get("/institutional-entities")
async def get_institutional_entities() -> dict[str, object]:
    """取得三大法人個體機構清單：自營商、外商券商、投信."""
    cached_at_raw = _entities_cache.get("cached_at", 0.0)
    cached_at = float(cached_at_raw) if isinstance(cached_at_raw, int | float | str) else 0.0

    if _is_cache_valid(cached_at):
        return {
            "dealers": _entities_cache.get("dealers", []),
            "foreign_brokers": _entities_cache.get("foreign_brokers", []),
            "investment_trusts": _entities_cache.get("investment_trusts", []),
        }

    dealers: list[dict[str, str]] = []
    foreign_brokers: list[dict[str, str]] = []

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(
                "https://openapi.twse.com.tw/v1/opendata/t187ap18",
                headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            )
            resp.raise_for_status()
            brokers_data = resp.json()
    except httpx.HTTPError as exc:
        return {"error": f"TWSE t187ap18 失敗: {str(exc)}"}, 500

    for item in brokers_data:
        if not isinstance(item, dict):
            continue
        code = str(item.get("證券代號", "")).strip()
        name = str(item.get("券商(證券IB)簡稱", "")).strip()
        business_types = str(item.get("業務種類", "")).strip()
        phone = str(item.get("電話", "")).strip()

        classification = _classify_broker(name, business_types)
        entry = {
            "code": code,
            "name": name,
            "business_types": business_types,
            "phone": phone,
        }
        if classification == "dealer":
            dealers.append(entry)
        elif classification == "foreign_broker":
            foreign_brokers.append(entry)

    investment_trusts: list[dict[str, str]] = []
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(
                "https://www.sitca.org.tw/ROC/Industry/IN4002.aspx?PGMID=IN0402",
                headers={"User-Agent": _USER_AGENT, "Accept": "text/html"},
            )
            resp.raise_for_status()
            html_text = resp.content.decode("utf-8", errors="ignore")
    except httpx.HTTPError:
        investment_trusts = []
    else:
        import re
        rows = re.findall(
            r'<td[^>]+>A(\d{4})</td>\s*<td[^>]+>([^<]+)</td>',
            html_text,
            flags=re.IGNORECASE,
        )
        for code_digits, full_name in rows:
            investment_trusts.append({
                "code": f"A{code_digits}",
                "name": full_name.strip(),
            })

    _entities_cache["cached_at"] = datetime.now(timezone.utc).timestamp()
    _entities_cache["dealers"] = sorted(dealers, key=lambda x: x["code"])
    _entities_cache["foreign_brokers"] = sorted(foreign_brokers, key=lambda x: x["code"])
    _entities_cache["investment_trusts"] = sorted(investment_trusts, key=lambda x: x["code"])

    return {
        "dealers": dealers,
        "foreign_brokers": foreign_brokers,
        "investment_trusts": investment_trusts,
    }


_institutional_total_cache: dict[str, object] = {
    "cached_at": 0.0,
    "data": [],
    "date": "",
}


_INSTITUTIONAL_TOTAL_NAMES: dict[str, str] = {
    "Foreign_Investor": "外國投資者",
    "Investment_Trust": "投信",
    "Dealer_self": "自營商(自行)",
    "Dealer_Hedging": "自營商(避險)",
    "Foreign_Dealer_Self": "外國自營商",
    "total": "合計",
}


def _get_yesterday_date() -> str:
    from datetime import date, timedelta
    return (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")


@router.get("/institutional-total")
async def get_institutional_total(date: str | None = None) -> dict[str, object]:
    target_date = date if date else _get_yesterday_date()

    cached = _institutional_total_cache.get("date") == target_date
    cached_at_raw = float(_institutional_total_cache.get("cached_at", 0.0))
    if cached and _is_cache_valid(cached_at_raw):
        return {
            "data": _institutional_total_cache.get("data", []),
            "date": _institutional_total_cache.get("date", ""),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(
                "https://api.finmindtrade.com/api/v4/data",
                params={
                    "dataset": "TaiwanStockTotalInstitutionalInvestors",
                    "start_date": target_date,
                    "end_date": target_date,
                },
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as exc:
        return {"error": str(exc)}, 500

    if payload.get("status") != 200:
        return {"error": payload.get("msg", "Unknown error")}, 500

    raw_data = payload.get("data", [])
    rows = []
    for item in raw_data:
        if not isinstance(item, dict):
            continue
        name_key = str(item.get("name", ""))
        translated = _INSTITUTIONAL_TOTAL_NAMES.get(name_key, name_key)
        buy = int(item.get("buy", 0) or 0)
        sell = int(item.get("sell", 0) or 0)
        rows.append({
            "name": translated,
            "nameKey": name_key,
            "buy": buy,
            "sell": sell,
            "net": buy - sell,
        })

    rows.sort(key=lambda x: (
        0 if x["nameKey"] == "total" else
        1 if x["nameKey"] == "Foreign_Investor" else
        2 if x["nameKey"] == "Investment_Trust" else
        3 if x["nameKey"] == "Dealer_self" else
        4 if x["nameKey"] == "Dealer_Hedging" else 5
    ))

    _institutional_total_cache["data"] = rows
    _institutional_total_cache["date"] = target_date
    _institutional_total_cache["cached_at"] = datetime.now(timezone.utc).timestamp()

    return {
        "data": rows,
        "date": target_date,
    }


_broker_total_cache: dict[str, object] = {
    "cached_at": 0.0,
    "data": [],
    "date": "",
}


def _get_yesterday_date_roc() -> str:
    from datetime import date, timedelta
    d = date.today() - timedelta(days=1)
    roc_year = d.year - 1911
    return f"{roc_year}{d.month:02d}{d.day:02d}"


@router.get("/broker-total")
async def get_broker_total(date: str | None = None) -> dict[str, object]:
    target_date = date if date else _get_yesterday_date_roc()

    cached = _broker_total_cache.get("date") == target_date
    cached_at_raw = float(_broker_total_cache.get("cached_at", 0.0))
    if cached and _is_cache_valid(cached_at_raw):
        return {
            "data": _broker_total_cache.get("data", []),
            "date": _broker_total_cache.get("date", ""),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
            resp = await client.get(
                "https://www.twse.com.tw/fund/BFI82U",
                params={
                    "response": "json",
                    "type": "day",
                    "dayDate": target_date,
                },
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Referer": "https://www.twse.com.tw/zh/trading/statistics/sd.html",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError:
        pass
    except Exception:
        pass

    if payload.get("stat") == "OK":
        raw_data = payload.get("data", [])
        if isinstance(raw_data, list):
            rows = []
            for item in raw_data:
                if not isinstance(item, list) or len(item) < 4:
                    continue
                name = str(item[0]).strip()
                buy = int(str(item[1]).replace(",", "").strip())
                sell = int(str(item[2]).replace(",", "").strip())
                net = int(str(item[3]).replace(",", "").strip())
                rows.append({"name": name, "buy": buy, "sell": sell, "net": net})
            _broker_total_cache["data"] = rows
            _broker_total_cache["date"] = target_date
            _broker_total_cache["cached_at"] = datetime.now(timezone.utc).timestamp()
            return {"data": rows, "date": target_date, "source": "twse"}

    return {
        "data": [],
        "date": target_date,
        "error": "TWSE BFI82U 暫時無法存取，請稍後再試",
    }
