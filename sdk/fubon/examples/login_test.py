"""富邦新一代 API 登入 smoke test（只登入 + 列帳號，不下單）。

用法：
    cd /home/daniel/github/aistock/backend && source .venv/bin/activate
    python ../sdk/fubon/examples/login_test.py

前置：
    專案根目錄 .env 需有 FUBON_PERSONAL_ID / FUBON_PASSWORD / FUBON_CERT_PATH / FUBON_CERT_PASSWORD。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fubon_neo.sdk import FubonSDK

ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")


def _cert_path() -> str:
    cert = os.environ["FUBON_CERT_PATH"]
    return cert if os.path.isabs(cert) else str((ROOT / cert).resolve())


def main() -> int:
    sdk = FubonSDK()
    result = sdk.login(
        os.environ["FUBON_PERSONAL_ID"],
        os.environ["FUBON_PASSWORD"],
        _cert_path(),
        os.environ.get("FUBON_CERT_PASSWORD") or None,
    )

    print("is_success:", getattr(result, "is_success", None))
    print("message  :", getattr(result, "message", None))

    accounts = getattr(result, "data", None) or []
    print(f"帳號數   : {len(accounts)}")
    for acc in accounts:
        print(
            f"  - 姓名={getattr(acc, 'name', '?')}"
            f" 帳號={getattr(acc, 'account', '?')}"
            f" 分公司={getattr(acc, 'branch_no', '?')}"
            f" 類型={getattr(acc, 'account_type', '?')}"
        )

    sdk.logout()
    return 0 if getattr(result, "is_success", False) else 1


if __name__ == "__main__":
    sys.exit(main())
