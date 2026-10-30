"""yfinance suffix resolution for Taiwan listed instruments.

台股為主：上市 → ``.TW``，上櫃 → ``.TWO``。未來新增市場時，只要在
``_MARKET_SUFFIX`` 加一筆對照即可，其餘呼叫端不必改。

``twstock`` is imported lazily (inside the function) on purpose: its CLI module
breaks inside Celery workers (LoggingProxy), so callers that already know the
market can pass ``market=`` and avoid the import entirely.
"""

from __future__ import annotations

DEFAULT_SUFFIX = ".TW"

_MARKET_SUFFIX: dict[str, str] = {
    "上市": ".TW",
    "上櫃": ".TWO",
}


def yf_suffix(market: str | None) -> str:
    """Return the yfinance suffix for a market name (unknown → ``.TW``)."""
    return _MARKET_SUFFIX.get(market or '', DEFAULT_SUFFIX)


def yf_symbol(symbol: str, market: str | None = None) -> str:
    """Return the yfinance ticker for ``symbol``.

    ``market`` may be supplied by the caller (e.g. from stock_codes / a universe
    file); when omitted it is resolved from ``twstock.codes``. Unknown or missing
    markets fall back to :data:`DEFAULT_SUFFIX`.
    """
    if market is None:
        import twstock

        info = twstock.codes.get(symbol)
        market = info.market if info is not None else None
    return f"{symbol}{_MARKET_SUFFIX.get(market or '', DEFAULT_SUFFIX)}"
