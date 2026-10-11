"""離線版 backend 入口（PyInstaller 打包用）。

不能寫 uvicorn.run("src.main:app", ...)：PyInstaller 靜態分析追不到字串
形式的 import，會漏包 src 套件。直接 import app 物件才保證被 bundle。
"""
import uvicorn

from src.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=38000, log_level="info")
