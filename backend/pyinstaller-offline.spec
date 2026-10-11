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
    "xgboost",
    "lightgbm",
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

hiddenimports = []
for _p in _COLLECT_PKGS:
    # on_error="warn": 選用子模組（如 celery.security 需 cryptography）缺依賴時
    # 跳過而非中止整個打包
    hiddenimports += collect_submodules(_p, on_error="warn")

datas = []
for _p in ("sklearn", "xgboost", "lightgbm", "celery", "yfinance"):
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
