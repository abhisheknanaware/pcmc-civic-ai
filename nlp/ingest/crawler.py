"""Polite crawler for public PCMC pages and documents.

Rules: only allow-listed domains and URL patterns (sources.json), robots.txt respected,
one request every `delay_seconds`, no login pages, no forms except the public language toggle
and the public circular archive filter. Raw responses are stored with a content hash so
re-crawls can detect changes.

Usage:  python -m ingest.crawler [--limit N] [--skip-circulars] [--refresh-days 7]
"""
import argparse
import hashlib
import json
import re
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, urldefrag, quote
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "data" / "crawl"
RAW = DATA / "raw"
INDEX_PATH = DATA / "index.json"
CIRCULARS_PATH = DATA / "circulars.json"
EXTERNAL_PATH = DATA / "external_links.json"

CONFIG = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
RULES = [(re.compile(r["pattern"]), r) for r in CONFIG["rules"]]
EXCLUDE = [re.compile(p) for p in CONFIG["exclude"]]
DOMAINS = set(CONFIG["domains"])


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize(url, base=None):
    url = urljoin(base, url.strip()) if base else url.strip()
    url, _ = urldefrag(url)
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return None
    path = quote(parts.path, safe="/%()._-~")
    return parts._replace(path=path, netloc=parts.netloc.lower()).geturl()


def is_pdf(url):
    return urlparse(url).path.lower().endswith(".pdf")


CIRC_WANT = [w.lower() for w in CONFIG["circulars"]["download_if_title_matches"]]
CIRC_SKIP = [w.lower() for w in CONFIG["circulars"]["skip_if_title_matches"]]


def circular_relevant(title):
    """Citizen-facing circulars only. Staff orders (retirements, postings, recruitment) name
    individual employees, so they are never downloaded or indexed."""
    low = title.lower()
    return any(w in low for w in CIRC_WANT) and not any(w in low for w in CIRC_SKIP)


def classify(url):
    """Return the matching allow rule (category, authority, department) or None."""
    if urlparse(url).netloc not in DOMAINS:
        return None
    if any(p.search(url) for p in EXCLUDE):
        return None
    for pattern, rule in RULES:
        m = pattern.search(url)
        if m:
            return {"category": rule["category"], "authority": rule["authority"],
                    "department": (m.groupdict().get("dept") or None)}
    return None


class Crawler:
    def __init__(self, refresh_days=7, limit=None):
        RAW.mkdir(parents=True, exist_ok=True)
        self.index = json.loads(INDEX_PATH.read_text(encoding="utf-8")) if INDEX_PATH.exists() else {}
        self.refresh_days = refresh_days
        self.limit = limit
        self.fetched = 0
        self.last_request = 0.0
        self.robots = {}
        self.external = {}
        self.clients = {}
        for lang in CONFIG["languages"]:
            client = httpx.Client(headers={"User-Agent": CONFIG["user_agent"]}, timeout=CONFIG["timeout_seconds"],
                                  follow_redirects=True)
            self._wait()
            client.post(CONFIG["language_endpoint"], data={"lang": lang})
            self.clients[lang] = client

    # ---------- politeness ----------
    def _wait(self):
        gap = CONFIG["delay_seconds"] - (time.monotonic() - self.last_request)
        if gap > 0:
            time.sleep(gap)
        self.last_request = time.monotonic()

    def allowed(self, url):
        host = urlparse(url).netloc
        if host not in self.robots:
            rp = RobotFileParser()
            try:
                self._wait()
                r = self.clients[CONFIG["languages"][0]].get(f"https://{host}/robots.txt")
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except httpx.HTTPError:
                rp.parse([])
            self.robots[host] = rp
        return self.robots[host].can_fetch(CONFIG["user_agent"], url)

    # ---------- fetching ----------
    def fresh(self, key):
        rec = self.index.get(key)
        if not rec or rec.get("status") != 200:
            return False
        age = datetime.now(timezone.utc) - datetime.fromisoformat(rec["fetched_at"])
        return age.days < self.refresh_days

    def fetch(self, url, lang, meta):
        key = url if is_pdf(url) else f"{lang}|{url}"
        if self.fresh(key):
            return self.index[key], None
        if self.limit and self.fetched >= self.limit:
            return None, None
        if not self.allowed(url):
            self.index[key] = {**meta, "key": key, "url": url, "lang": lang, "status": "robots_disallowed", "fetched_at": now_iso()}
            return None, None

        prev = self.index.get(key, {})
        headers = {}
        if prev.get("etag"):
            headers["If-None-Match"] = prev["etag"]
        if prev.get("last_modified"):
            headers["If-Modified-Since"] = prev["last_modified"]

        max_bytes = CONFIG["max_pdf_mb"] * 1024 * 1024
        self._wait()
        self.fetched += 1
        try:
            with self.clients[lang].stream("GET", url, headers=headers) as r:
                if r.status_code == 304:
                    prev.update(fetched_at=now_iso(), changed=False)
                    return prev, None
                chunks, size = [], 0
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("too_large")
                    chunks.append(chunk)
                body = b"".join(chunks)
                status, ctype = r.status_code, r.headers.get("content-type", "")
                etag, last_mod, final_url = r.headers.get("etag"), r.headers.get("last-modified"), str(r.url)
        except (httpx.HTTPError, ValueError) as err:
            self.index[key] = {**prev, **meta, "key": key, "url": url, "lang": lang,
                               "status": f"error:{type(err).__name__}:{err}"[:120], "fetched_at": now_iso()}
            return None, None

        digest = hashlib.sha256(body).hexdigest()
        ext = ".pdf" if "pdf" in ctype or is_pdf(url) else ".html"
        raw_path = RAW / (hashlib.sha1(key.encode()).hexdigest() + ext)
        if status == 200:
            raw_path.write_bytes(body)
        rec = {**meta, "key": key, "url": url, "final_url": final_url, "lang": None if ext == ".pdf" else lang,
               "status": status, "content_type": ctype, "bytes": len(body), "sha256": digest,
               "previous_sha256": prev.get("sha256"), "changed": bool(prev.get("sha256")) and prev.get("sha256") != digest,
               "first_seen": prev.get("first_seen") or now_iso(), "fetched_at": now_iso(),
               "etag": etag, "last_modified": last_mod, "raw_path": str(raw_path.relative_to(DATA)) if status == 200 else None}
        self.index[key] = rec
        if self.fetched % 25 == 0:
            self.save()
        print(f"[{self.fetched}] {status} {lang[:2]} {meta.get('category')} {url[:110]}", flush=True)
        return rec, body if ext == ".html" and status == 200 else None

    # ---------- discovery ----------
    def links(self, html, base):
        soup = BeautifulSoup(html, "lxml")
        main = soup.select_one("main#content") or soup
        found = []
        for a in soup.find_all("a", href=True):
            url = normalize(a["href"], base)
            if not url:
                continue
            in_main = main is not soup and main in a.parents
            host = urlparse(url).netloc
            if host not in DOMAINS:
                if in_main and host:
                    entry = self.external.setdefault(host, {"count": 0, "examples": [], "anchors": []})
                    entry["count"] += 1
                    if len(entry["examples"]) < 5 and url not in entry["examples"]:
                        entry["examples"].append(url)
                        entry["anchors"].append(a.get_text(" ", strip=True)[:60])
                continue
            found.append(url)
        return found

    def sitemap_urls(self):
        self._wait()
        r = self.clients[CONFIG["languages"][0]].get(CONFIG["sitemap"])
        return [normalize(u) for u in re.findall(r"<loc>([^<]+)</loc>", r.text)]

    def crawl_pages(self):
        queue = deque()
        seen = set()
        for url in [normalize(u) for u in CONFIG["seeds"]] + self.sitemap_urls():
            if url and url not in seen and classify(url) and classify(url)["category"] != "circular":
                seen.add(url)
                queue.append((url, 0, "seed"))
        while queue:
            url, depth, parent = queue.popleft()
            rule = classify(url)
            langs = [None] if is_pdf(url) else CONFIG["languages"]
            for lang in langs:
                meta = {**rule, "depth": depth, "discovered_from": parent}
                rec, html = self.fetch(url, lang or CONFIG["languages"][0], meta)
                if html is None and rec and rec.get("raw_path") and rec["raw_path"].endswith(".html") and depth < CONFIG["max_depth"]:
                    html = (DATA / rec["raw_path"]).read_bytes()
                if html is not None and depth < CONFIG["max_depth"]:
                    for link in self.links(html.decode("utf-8", "ignore"), url):
                        if link not in seen and classify(link) and classify(link)["category"] != "circular":
                            seen.add(link)
                            queue.append((link, depth + 1, url))
            if self.limit and self.fetched >= self.limit:
                print("limit reached")
                break

    # ---------- circular archive ----------
    def crawl_circulars(self, relist=True):
        cfg = CONFIG["circulars"]
        circulars = {c["pdf_url"]: c for c in json.loads(CIRCULARS_PATH.read_text(encoding="utf-8"))} if CIRCULARS_PATH.exists() else {}
        today = datetime.now()
        client = self.clients[CONFIG["languages"][0]]
        for year in ([] if not relist else cfg["years"]):
            for month in range(1, 13):
                if (year, month) > (today.year, today.month):
                    break
                self._wait()
                try:
                    r = client.get(cfg["listing"], params={"Year": str(year), "month": f"{month:02d}", "btn_search": "frm_submit"})
                except httpx.HTTPError as err:
                    print("listing error", year, month, err)
                    continue
                soup = BeautifulSoup(r.text, "lxml")
                rows = 0
                for tr in soup.select("main#content table tbody tr"):
                    tds = tr.find_all("td")
                    a = tr.find("a", href=True)
                    if len(tds) < 5 or not a:
                        continue
                    pdf_url = normalize(a["href"], cfg["listing"])
                    title = " ".join(tds[1].get_text(" ", strip=True).split())
                    date = tds[3].get_text(strip=True)
                    try:
                        iso = datetime.strptime(date, "%d-%m-%Y").date().isoformat()
                    except ValueError:
                        iso = None
                    relevant = circular_relevant(title)
                    circulars[pdf_url] = {"pdf_url": pdf_url, "title": title, "ref_no": " ".join(tds[2].get_text(" ", strip=True).split()),
                                          "published_date": iso, "doc_kind": tds[4].get_text(strip=True), "listed_year": year,
                                          "listed_month": month, "relevant": relevant, "last_listed": now_iso()}
                    rows += 1
                print(f"circulars {year}-{month:02d}: {rows} rows", flush=True)
        for c in circulars.values():
            c["relevant"] = circular_relevant(c["title"])
        CIRCULARS_PATH.write_text(json.dumps(list(circulars.values()), ensure_ascii=False, indent=1), encoding="utf-8")
        self.prune_circulars({u for u, c in circulars.items() if c["relevant"]})

        for c in circulars.values():
            if not c["relevant"] or not classify(c["pdf_url"]):
                continue
            meta = {**classify(c["pdf_url"]), "depth": 1, "discovered_from": cfg["listing"],
                    "title": c["title"], "ref_no": c["ref_no"], "published_date": c["published_date"], "doc_kind": c["doc_kind"]}
            self.fetch(c["pdf_url"], CONFIG["languages"][0], meta)
            if self.limit and self.fetched >= self.limit:
                break

    def prune_circulars(self, keep):
        """Delete downloaded circulars that are not citizen-facing (raw file + index entry)."""
        removed = 0
        for key, rec in list(self.index.items()):
            if rec.get("category") == "circular" and rec["url"] not in keep:
                if rec.get("raw_path") and (DATA / rec["raw_path"]).exists():
                    (DATA / rec["raw_path"]).unlink()
                del self.index[key]
                removed += 1
        if removed:
            print(f"pruned {removed} non-citizen circulars")

    def save(self):
        DATA.mkdir(parents=True, exist_ok=True)
        INDEX_PATH.write_text(json.dumps(self.index, ensure_ascii=False, indent=1), encoding="utf-8")
        EXTERNAL_PATH.write_text(json.dumps(dict(sorted(self.external.items(), key=lambda kv: -kv[1]["count"])),
                                            ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="max network fetches this run")
    ap.add_argument("--refresh-days", type=int, default=7)
    ap.add_argument("--skip-circulars", action="store_true")
    ap.add_argument("--skip-pages", action="store_true")
    ap.add_argument("--no-relist", action="store_true", help="reuse the saved circular listing instead of re-reading the archive")
    args = ap.parse_args()
    crawler = Crawler(refresh_days=args.refresh_days, limit=args.limit)
    try:
        if not args.skip_pages:
            crawler.crawl_pages()
        if not args.skip_circulars:
            crawler.crawl_circulars(relist=not args.no_relist)
    except KeyboardInterrupt:
        print("interrupted, saving progress")
    finally:
        crawler.save()
    ok = sum(1 for r in crawler.index.values() if r.get("status") == 200)
    print(f"done: {crawler.fetched} fetches this run, {ok} documents stored", file=sys.stderr)


if __name__ == "__main__":
    main()
