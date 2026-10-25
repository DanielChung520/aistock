"""富邦新一代 API 行情測試：登入 → init_realtime → 試抓 ticker / 日K。

用法：
    cd /home/daniel/github/aistock/backend && source .venv/bin/activate
    python ../sdk/fubon/examples/marketdata_test.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fubon_neo.sdk import FubonSDK

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")


def _cert() -> str:
    c = os.environ["FUBON_CERT_PATH"]
    return c if os.path.isabs(c) else str((ROOT / c).resolve())


def show(label: str, fn) -> None:
    print(f"\n--- {label} ---")
    try:
        res = fn()
        print("type:", type(res).__name__)
        print(res)
    except Exception as exc:  # noqa: BLE001 - 測試用，需印出所有錯誤
        print(f"ERROR: {type(exc).__name__}: {exc}")


def main() -> int:
    sdk = FubonSDK()
    result = sdk.login(
        os.environ["FUBON_PERSONAL_ID"],
        os.environ["FUBON_PASSWORD"],
        _cert(),
        os.environ.get("FUBON_CERT_PASSWORD") or None,
    )
    print("login is_success:", getattr(result, "is_success", None))
    print("login message   :", getattr(result, "message", None))

    try:
        sdk.init_realtime()
        print("init_realtime: OK")
    except Exception as exc:  # noqa: BLE001
        print(f"init_realtime ERROR: {type(exc).__name__}: {exc}")

    md = getattr(sdk, "marketdata", None)
    print("sdk.marketdata:", type(md).__name__)
    if md is None:
        print("=> 無 marketdata（登入未生效 / 無行情權限）")
        return 1

    rest = md.rest_client.stock
    show("intraday.ticker 2330（即時 ticker）", lambda: rest.intraday.ticker(symbol="2330"))
    show("intraday.quote 2330（即時報價）", lambda: rest.intraday.quote(symbol="2330"))
    show("historical.candles 2330 timeframe=D（日K）", lambda: rest.historical.candles(symbol="2330", timeframe="D"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
