#!/usr/bin/env python3
"""Faux neetcode.io local pour tester l'extension sans compte ni Safari.

Sert le harnais (`tests/harness/`) et les fichiers de `extension/`, et reproduit
les trois endpoints réellement utilisés par NeetCode :

    POST /api/getProblemMetadataFunctionHttp  → métadonnées du problème
    POST /api/executeCodeFunctionHttp         → submit d'un problème de code
    POST /api/runCodeFunctionHttp             → bouton « Run » (jamais un submit)
    POST /api/runSqlFunctionHttp              → run OU submit SQL selon `runOnly`

Les formes de réponse sont copiées sur celles observées en production.

    python3 tests/serve.py [port]
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS_DIR = os.path.join(ROOT, "tests", "harness")
EXTENSION_DIR = os.path.join(ROOT, "extension")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
}

PROBLEMS = {
    "duplicate-integer": {"name": "Contains Duplicate", "difficulty": "Easy"},
    "valid-sudoku": {"name": "Valid Sudoku", "difficulty": "Medium"},
    "sql-playground": {"name": "SQL Playground", "difficulty": "Hard"},
}


def accepted_payload(description, correct, total):
    """Forme observée : `{ data: { status: { description }, … } }`."""
    return {
        "data": {
            "status": {"id": 3 if description == "Accepted" else 4, "description": description},
            "test_case_count": total,
            "correct_test_case_count": correct,
            "stdout": "",
            "stderr": "",
            "memory": 17_432,
            "time": "0.042",
            "date": "2026-08-09T18:00:00.000Z",
            "submissionIndex": 0,
        }
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # bruit inutile
        sys.stderr.write("  %s\n" % (fmt % args))

    # --- helpers ----------------------------------------------------------
    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not os.path.isfile(path):
            self.send_error(404, "not found: %s" % path)
            return
        with open(path, "rb") as handle:
            body = handle.read()
        ext = os.path.splitext(path)[1]
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_extension_page(self, name):
        """Sert popup/ ou options/ tel quel, avec le stub des API injecté.

        `<base>` fait résoudre les chemins relatifs de la page comme dans
        l'extension : un seul HTML, pas de copie dans le harnais.
        """
        path = os.path.join(EXTENSION_DIR, name, "index.html")
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "r", encoding="utf-8") as handle:
            html = handle.read()
        # Le popup et les options parlent au background : on le démarre ici
        # aussi, dans la même page, derrière le stub de runtime.sendMessage.
        background = "".join(
            f'<script src="/extension/{src}"></script>'
            for src in (
                "vendor/ts-fsrs.umd.js",
                "src/config.js",
                "src/due.js",
                "src/storage.js",
                "src/fsrs.js",
                "src/background-core.js",
            )
        )
        injection = (
            f'<base href="/extension/{name}/" />'
            '<script src="/harness/stub-browser.js"></script>'
            + background
            + "<script>self.NCC.startBackground();</script>"
        )
        html = html.replace("<head>", "<head>" + injection, 1)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def safe_join(self, base, relative):
        target = os.path.normpath(os.path.join(base, relative.lstrip("/")))
        if not target.startswith(base):
            return None
        return target

    # --- routes -----------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/" or path.startswith("/problems/"):
            self.send_file(os.path.join(HARNESS_DIR, "index.html"))
            return
        if path in ("/harness/popup", "/harness/options"):
            self.send_extension_page(path.rsplit("/", 1)[1])
            return
        if path.startswith("/harness/"):
            target = self.safe_join(HARNESS_DIR, path[len("/harness/") :])
            self.send_file(target) if target else self.send_error(403)
            return
        if path.startswith("/extension/"):
            target = self.safe_join(EXTENSION_DIR, path[len("/extension/") :])
            self.send_file(target) if target else self.send_error(403)
            return
        self.send_error(404)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        query = parse_qs(url.query)
        body = self.read_json_body()
        data = body.get("data") if isinstance(body, dict) else None
        data = data if isinstance(data, dict) else {}

        if path == "/api/getProblemMetadataFunctionHttp":
            problem_id = data.get("problemId")
            problem = PROBLEMS.get(problem_id)
            if problem is None:
                self.send_json({"data": None}, status=404)
                return
            self.send_json(
                {
                    "data": {
                        "id": problem_id,
                        "name": problem["name"],
                        "difficulty": problem["difficulty"],
                        "tag": "NeetCode150",
                        "free": True,
                    }
                }
            )
            return

        verdict = (query.get("verdict") or ["Accepted"])[0]

        if path == "/api/executeCodeFunctionHttp":
            total = 20
            correct = total if verdict == "Accepted" else 7
            self.send_json(accepted_payload(verdict, correct, total))
            return

        if path == "/api/runCodeFunctionHttp":
            # Le bouton « Run » renvoie la même forme : c'est l'endpoint qui
            # doit permettre de l'ignorer, jamais le contenu.
            self.send_json(accepted_payload("Accepted", 2, 2))
            return

        if path == "/api/runSqlFunctionHttp":
            self.send_json(accepted_payload(verdict, 1, 1))
            return

        self.send_error(404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Faux NeetCode sur http://127.0.0.1:{port}/problems/duplicate-integer/question")
    print(f"Tests automatiques : http://127.0.0.1:{port}/problems/duplicate-integer/question?autotest=1")
    server.serve_forever()


if __name__ == "__main__":
    main()
