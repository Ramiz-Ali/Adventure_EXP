#!/usr/bin/env python3
"""
Dev server with no caching — replaces `python3 -m http.server`.

This server fixes Chrome's stubborn ES-module memory cache by rewriting every
relative `import ... from './foo.js'` into `import ... from './foo.js?v=<mtime>'`
where <mtime> is the file's last-modified time. Every edit to a .js file changes
its mtime → new URL → Chrome treats it as a brand-new module and refetches.

Also sends Cache-Control: no-store on every response.

Usage:
    python3 dev-server.py
    python3 dev-server.py 9000
"""

import os
import re
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


# Matches static import + dynamic import + export-from of RELATIVE paths.
_IMPORT_RE = re.compile(
    r"""(from\s*['"]|import\s*\(\s*['"])(\.[^'"?]+?\.js)(['"])"""
)


def _mtime_of(path: str) -> str:
    try:
        return str(int(os.path.getmtime(path)))
    except OSError:
        return "0"


def _rewrite_imports(content: bytes, base_dir: str) -> bytes:
    text = content.decode("utf-8", errors="replace")

    def sub(m):
        prefix, rel, quote = m.group(1), m.group(2), m.group(3)
        target_path = os.path.normpath(os.path.join(base_dir, rel))
        mtime = _mtime_of(target_path)
        return f"{prefix}{rel}?v={mtime}{quote}"

    return _IMPORT_RE.sub(sub, text).encode("utf-8")


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header(
            "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    # Override file-serving so we can rewrite .js/.html imports before sending.
    def do_GET(self):
        path = self.translate_path(self.path.split("?", 1)[0])

        if not (path.endswith(".js") or path.endswith(".html")) or not os.path.isfile(path):
            return super().do_GET()

        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError:
            return super().do_GET()

        base_dir = os.path.dirname(path)
        rewritten = _rewrite_imports(raw, base_dir)

        ctype = "application/javascript" if path.endswith(".js") else "text/html"
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(rewritten)))
        self.end_headers()
        self.wfile.write(rewritten)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Dev server (no cache + import rewriting) on http://localhost:{port}")
    print(f"Open http://localhost:{port}/adventureexp_portal.html")
    print("Edit any .js file — the next refresh always pulls fresh code.")
    print("Ctrl+C to stop")
    HTTPServer(("", port), NoCacheHandler).serve_forever()
