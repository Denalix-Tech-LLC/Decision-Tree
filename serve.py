"""Dev server for the decision tree.

python -m http.server sends no cache headers, so Chrome applies heuristic
caching and happily serves a stale copy of index.html after an edit — which
looked exactly like a change not working. This sends no-store on everything.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # match Vercel's cleanUrls: /admin serves admin.html
        p = SimpleHTTPRequestHandler.translate_path(self, path)
        if not os.path.exists(p) and not os.path.splitext(p)[1]:
            if os.path.isfile(p + ".html"):
                return p + ".html"
        return p

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        SimpleHTTPRequestHandler.end_headers(self)

    def guess_type(self, path):
        t = SimpleHTTPRequestHandler.guess_type(self, path)
        # be explicit about UTF-8 so em dashes and section signs survive
        if t in ("text/html", "text/css", "application/javascript", "text/javascript"):
            return t + "; charset=utf-8"
        return t

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    print("serving on http://localhost:%d  (no-store)" % port)
    ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
