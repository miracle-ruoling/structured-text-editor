import argparse
import json
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from .api import create_app


def main():
    parser = argparse.ArgumentParser(description="文序 · 本机结构化文档工作台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"

    def ready():
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=1) as result:
                return json.load(result).get("app") == "structured-editor"
        except (urllib.error.URLError, ValueError, TimeoutError):
            return False

    if ready():
        print(f"文序已在运行：{url}")
        if not args.no_browser:
            webbrowser.open(url)
        return

    if not args.no_browser:

        def open_when_ready():
            for _ in range(40):
                if ready():
                    webbrowser.open(url)
                    return
                time.sleep(0.25)

        threading.Thread(target=open_when_ready, daemon=True).start()
    uvicorn.run(create_app(args.data_dir), host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
