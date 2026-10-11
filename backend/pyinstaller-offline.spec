# pyinstaller-offline.spec — 離線版 backend sidecar（排除 torch）
# 用法（Windows CI）：pyinstaller pyinstaller-offline.spec --noconfirm --clean
#
# 背景：main.py 的啟動鏈不應包含 torch（TX-RL 訓練是伺服器排程工作）。
# 已把 routers/tx_rl.py 對 tasks/tx_rl_training 的 import 改為 lazy，
# 切斷 stable-baselines3 → torch 的 top-level 依賴；這裡再以 excludes 保險。
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

_COLLECT_PKGS = [
    "celery",
    "duckdb",
    "sklearn",
    "yfinance",
    "twstock",
    "apscheduler",
    "python_arango",
    "boto3",
    "pyarrow",
    "lxml",
    "gymnasium",
]

# xgboost/lightgbm 的 testing 子模組在 import 時會丟 pytest.Skipped（BaseException，
# 非 Exception），collect_submodules 的 on_error="warn" 接不住 → 不放進 collect；
# 其原生 lib 由 PyInstaller 官方 hook 處理，把套件根加進 hiddenimports 即可。
hiddenimports = ["xgboost", "lightgbm"]
for _p in _COLLECT_PKGS:
    try:
        hiddenimports += collect_submodules(_p, on_error="warn")
    except BaseException as exc:  # noqa: BLE001 — 子模組可能丟 pytest.Skipped 等 BaseException
        print(f"WARNING: collect_submodules({_p}) 失敗，已跳過: {exc}")

datas = []
# twstock 執行時會讀 package 內 CSV（codes/twse_equities.csv 等），
# 必須以資料檔形式放到 _internal/twstock/codes/，否則 FileNotFoundError。
for _p in ("sklearn", "xgboost", "lightgbm", "celery", "yfinance", "twstock"):
    datas += collect_data_files(_p)

a = Analysis(
    ["offline_entry.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "torch",
        "torchvision",
        "torchaudio",
        "stable_baselines3",
        "sb3_contrib",
        "matplotlib",
        "pytest",
        "IPython",
        "notebook",
        "jupyter",
        "numba",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aistock-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="aistock-backend",
)
