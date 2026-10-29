"""Voice studio: a teleprompter that records your narration first, one part at a time.

    python3 voiceover_server.py      then open http://localhost:8766

Shows the spoken lines of script.md section by section and saves the recording to
voice/<part>.webm plus voice/<part>.marks.json (when you moved to each section), which
record.mjs uses to fit the screen video to your timing. Binds to 127.0.0.1 only.
"""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
VOICE = ROOT / "voice"
SCRIPT = ROOT / "script.md"
PORT = 8766
PARTS = ("part1", "part2")
MAX_BYTES = 200 * 1024 * 1024


def script_sections() -> dict[str, list[dict]]:
    """Spoken text of each section, in order, keyed by part (on-screen cues stripped)."""
    text = SCRIPT.read_text()
    parts = re.split(r"^## ", text, flags=re.M)[1:]
    result = {}
    for name, body in zip(PARTS, parts):
        chunks = re.split(r"\*\*\[(.*?)\]\*\*", body)
        result[name] = [
            {"screen": chunks[i], "text": " ".join(chunks[i + 1].replace("`", "").split()).rstrip("- ")}
            for i in range(1, len(chunks), 2)
        ]
    return result


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/", "/voiceover.html"):
            self._file(ROOT / "voiceover.html", "text/html; charset=utf-8")
        elif path == "/script.json":
            self._send(200, json.dumps(script_sections()).encode(), "application/json")
        elif m := re.fullmatch(r"/voice/(part[12])\.(webm|marks\.json)", path):
            self._file(VOICE / f"{m[1]}.{m[2]}", "audio/webm" if m[2] == "webm" else "application/json")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        part = query.get("part", [""])[0]
        ext = {"audio": "webm", "marks": "marks.json"}.get(query.get("kind", [""])[0])
        length = int(self.headers.get("Content-Length", 0))
        if urlparse(self.path).path != "/save" or part not in PARTS or not ext or not 0 < length <= MAX_BYTES:
            self._send(400, b"bad request", "text/plain")
            return
        VOICE.mkdir(exist_ok=True)
        (VOICE / f"{part}.{ext}").write_bytes(self.rfile.read(length))
        print(f"saved voice/{part}.{ext} ({length // 1024} KiB)")
        self._send(200, b"ok", "text/plain")

    def _file(self, path: Path, ctype: str) -> None:
        if not path.exists():
            self._send(404, b"not found", "text/plain")
            return
        data = path.read_bytes()
        # Range support so the browser can seek the video.
        rng = self.headers.get("Range")
        if rng and (m := re.fullmatch(r"bytes=(\d+)-(\d*)", rng)):
            start = int(m[1])
            end = int(m[2]) if m[2] else len(data) - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            data = data[start : end + 1]
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # keep the console to "saved ..." lines
        pass


if __name__ == "__main__":
    print(f"Voice-over studio on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
