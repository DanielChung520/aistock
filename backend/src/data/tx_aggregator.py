"""TX 1 分 K → 多週期 K 線聚合器。

核心規則：
1. **日/夜盤分桶**：08:45~13:45 為日盤，15:00~05:00 為夜盤。
2. **夜盤日期歸屬**：依 TAIFEX 慣例，夜盤（15:00~24:00）歸屬於**次日**的 date。
   - 範例：2024-09-30 15:00 的 tick，date = 2024-10-01
3. **跨午夜分桶**：00:00~05:00 屬於「前一日開盤的夜盤」→ date 是當天。
4. **預設 15 分鐘分桶**：09:00 / 09:15 / 09:30 ...（日盤）；15:00 / 15:15 ...（夜盤）
5. **第一根 K 對齊 08:45 / 15:00**：日盤 08:45 起算、夜盤 15:00 起算。

設計原則：
- **純函數**：input → output，不依賴外部狀態
- **可重現**：相同 input 永遠給相同 output（不依賴 datetime.now()）
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Literal

logger = logging.getLogger(__name__)

DAY_SESSION_START = time(8, 45)
DAY_SESSION_END = time(13, 45)
NIGHT_SESSION_START = time(17, 25)
NIGHT_SESSION_END = time(5, 0)

DAY_ALIGN_ANCHOR = time(8, 45)
NIGHT_ALIGN_ANCHOR = time(17, 25)

Session = Literal["day", "night"]


@dataclass(frozen=True)
class Bar:
    """單根 K 線（內部表示，便於聚合運算）。"""
    date: str          # YYYY-MM-DD
    time: str          # HH:MM
    session: Session
    open: float
    high: float
    low: float
    close: float
    volume: int
    contract: str = ""
    source: str = ""


def _classify_session(dt: datetime) -> Session:
    """判斷 datetime 屬於日盤或夜盤。

    規則（TX 規格）：
      - 08:45 ≤ t ≤ 13:45 → day
      - 13:46 ≤ t < 17:25 → 盤後時段，歸 day（量少，但仍視為日盤的一部分）
      - 17:25 ≤ t ≤ 23:59 或 00:00 ≤ t < 05:00 → night
      - 05:00 ≤ t < 08:45 → 盤前/午休，歸 day
    """
    t = dt.time()
    # 日盤（含收盤 + 盤後）
    if DAY_SESSION_START <= t < NIGHT_SESSION_START:
        return "day"
    # 夜盤
    if NIGHT_SESSION_START <= t <= time(23, 59, 59):
        return "night"
    if time(0, 0) <= t < NIGHT_SESSION_END:
        return "night"
    # 其他（盤前、午休）→ 預設 day
    return "day"


def _night_session_date(dt: datetime) -> str:
    """決定夜盤 tick 歸屬的交易日（date）。

    規則：
      - 17:25 ≤ t ≤ 23:59 → 歸屬次日
      - 00:00 ≤ t < 05:00 → 歸屬當日（已是前一夜盤的延續）
    """
    h, m = dt.hour, dt.minute
    if (h == 17 and m >= 25) or (18 <= h <= 23):
        return (dt.date() + timedelta(days=1)).isoformat()
    return dt.date().isoformat()


def _day_session_date(dt: datetime) -> str:
    """日盤的 date 就是當天。"""
    return dt.date().isoformat()


def _normalize_bar(bar: dict) -> Bar:
    """把 fetcher 回傳的 dict 轉成內部 Bar（順便決定 date/session）。"""
    # Shioaji/FinMind/QuantPass 都用 'date' + 'time' 字串
    date_str = bar.get("date", "")
    time_str = bar.get("time", "")
    if not date_str or not time_str:
        raise ValueError(f"Bar 缺少 date/time: {bar}")

    try:
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    except ValueError:
        # 試試帶秒數
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")

    # 重新判斷 session 與 date（避免來源資料不一致）
    session = bar.get("session") or _classify_session(dt)
    if session == "day":
        final_date = _day_session_date(dt)
    else:
        final_date = _night_session_date(dt)

    return Bar(
        date=final_date,
        time=dt.strftime("%H:%M"),
        session=session,  # type: ignore[arg-type]
        open=float(bar["open"]),
        high=float(bar["high"]),
        low=float(bar["low"]),
        close=float(bar["close"]),
        volume=int(bar.get("volume", 0)),
        contract=bar.get("contract", ""),
        source=bar.get("source", ""),
    )


def _bar_bucket_key(bar: Bar, minutes: int) -> tuple[str, str, Session]:
    """計算 K 線的桶位 key：(date, HH:MM 邊界, session)。

    邊界對齊：
      - 日盤：08:45 + N*minutes（第一根從 08:45 開始）
      - 夜盤：15:00 + N*minutes（第一根從 15:00 開始）
    """
    dt = datetime.strptime(f"{bar.date} {bar.time}", "%Y-%m-%d %H:%M")
    anchor = DAY_ALIGN_ANCHOR if bar.session == "day" else NIGHT_ALIGN_ANCHOR

    # 計算「自 anchor 經過幾分鐘」
    if bar.session == "day":
        minutes_since_anchor = (
            (dt - dt.replace(hour=anchor.hour, minute=anchor.minute, second=0, microsecond=0)).total_seconds() / 60
        )
    else:
        # 夜盤可能跨午夜（00:00~05:00），需特別處理
        if dt.hour < 8:
            # 已經是次日凌晨（屬於夜盤延續）
            base = dt.replace(hour=0, minute=0, second=0, microsecond=0)
            minutes_since_anchor = (
                (24 * 60 - (anchor.hour * 60 + anchor.minute)) + (base.hour * 60 + base.minute)
            )
        else:
            base = dt.replace(hour=anchor.hour, minute=anchor.minute, second=0, microsecond=0)
            minutes_since_anchor = (
                (dt - base).total_seconds() / 60
            )

    bucket_idx = int(minutes_since_anchor // minutes)
    bucket_minutes_offset = bucket_idx * minutes

    # 重建 HH:MM 邊界
    if bar.session == "day":
        bucket_total_min = anchor.hour * 60 + anchor.minute + bucket_minutes_offset
    else:
        night_anchor_total = anchor.hour * 60 + anchor.minute  # 15:00 = 900
        bucket_total_min = night_anchor_total + bucket_minutes_offset
        if bucket_total_min >= 24 * 60:
            bucket_total_min -= 24 * 60  # 跨午夜循環

    bucket_h = bucket_total_min // 60
    bucket_m = bucket_total_min % 60
    return (bar.date, f"{bucket_h:02d}:{bucket_m:02d}", bar.session)


def aggregate(
    bars: Iterable[dict],
    minutes: int = 15,
    contract: str = "",
) -> list[dict]:
    """把 1 分 K 聚合為 N 分 K。

    Parameters
    ----------
    bars : iterable of dict
        每個 dict 必須含 date, time, open, high, low, close, volume
        可選：session, contract, source
    minutes : int
        目標週期（5 / 15 / 30 / 60），預設 15
    contract : str
        若提供會寫入輸出 bar（覆蓋來源資料）

    Returns
    -------
    list of dict
        聚合後的 K 線，按 (date, time) 排序

    Notes
    -----
    - 第一根 K 從 08:45（日盤）/ 15:00（夜盤）對齊
    - 夜盤跨越 24:00 → 00:00，bucket 計算會自動處理
    - 同一個 bucket 內：open = 首根 open、close = 末根 close、
      high/low = max/min、volume = 加總
    """
    if minutes not in (1, 5, 15, 30, 60):
        raise ValueError(f"不支援的週期: {minutes}（須為 1/5/15/30/60）")

    if minutes == 1:
        # 1 分 K 不需聚合，只做 normalize
        result = []
        for b in bars:
            normalized = _normalize_bar(b)
            if contract:
                normalized = Bar(
                    **{**normalized.__dict__, "contract": contract}
                )
            result.append(_bar_to_dict(normalized))
        result.sort(key=lambda r: (r["date"], r["time"]))
        return result

    # 先 normalize + 分桶
    buckets: dict[tuple[str, str, Session], list[Bar]] = {}
    for b in bars:
        try:
            normalized = _normalize_bar(b)
        except (ValueError, KeyError) as exc:
            logger.warning("跳過無效 bar (%s): %s", exc, b)
            continue
        if contract:
            normalized = Bar(**{**normalized.__dict__, "contract": contract})
        key = _bar_bucket_key(normalized, minutes)
        buckets.setdefault(key, []).append(normalized)

    # 聚合
    result: list[dict] = []
    for (date_s, time_s, session), group in buckets.items():
        # 桶內 bar 須按時間排序
        group.sort(key=lambda b: b.time)
        result.append({
            "date": date_s,
            "time": time_s,
            "session": session,
            "open": group[0].open,
            "high": max(b.high for b in group),
            "low": min(b.low for b in group),
            "close": group[-1].close,
            "volume": sum(b.volume for b in group),
            "bar_minutes": minutes,
            "contract": group[0].contract,
            "source": group[0].source or "aggregated",
        })

    # 全域排序：先 date 再 time（同 date 內 day 早於 night）
    session_order = {"day": 0, "night": 1}
    result.sort(key=lambda r: (r["date"], session_order.get(r.get("session", "day"), 0), r["time"]))
    return result


def _bar_to_dict(bar: Bar) -> dict:
    """Bar → dict（給 1 分 K 路徑用）。"""
    return {
        "date": bar.date,
        "time": bar.time,
        "session": bar.session,
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "volume": bar.volume,
        "contract": bar.contract,
        "source": bar.source,
    }


def expand_to_continuous(
    raw_bars: list[dict],
    contract_to_continuous: dict[str, str],
) -> list[dict]:
    """把原始合約的 K 線加上 continuous 欄位（標記它是哪個連續月）。

    Parameters
    ----------
    raw_bars : list of dict
        已含 'contract' 欄位的 K 線
    contract_to_continuous : dict
        對照表，例如 {'TXF202509': 'R1', 'TXF202512': 'R2'}

    Returns
    -------
    list of dict
        每筆加上 'continuous' 欄位；若合約不在對照表內則為 None
    """
    for bar in raw_bars:
        c = bar.get("contract", "")
        bar["continuous"] = contract_to_continuous.get(c)
    return raw_bars
