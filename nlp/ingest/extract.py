"""Turn crawled raw files into clean documents with provenance and quality metadata.

HTML  -> main content of PCMC's page template (menus, sidebars and repeated boilerplate removed)
PDF   -> PyMuPDF text layer, with a quality check. Scanned pages, legacy-font garbage and broken
         Unicode are flagged `needs_ocr`; if Tesseract is installed they are OCR'd (mar+hin+eng)
         and the mean word confidence is stored.

Usage:  python -m ingest.extract [--ocr]
Output: data/crawl/documents.jsonl
"""
import argparse
import hashlib
import json
import os
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pymupdf
from bs4 import BeautifulSoup, Comment, NavigableString

from .crawler import DATA, INDEX_PATH, CIRCULARS_PATH, normalize

DOCS_PATH = DATA / "documents.jsonl"
DEVANAGARI = re.compile(r"[\u0900-\u097F]")
LATIN = re.compile(r"[A-Za-z]")
ODD = re.compile(r"[\u0100-\u02FF\u0370-\u03FF\u0400-\u04FF\uFFFD\x00]")
MIXED_CASE = re.compile(r"[a-z][A-Z]|[A-Z]{2}[a-z]")
MATRA = re.compile(r"[ा-ौॢॣ]")
CONSONANTS = set(chr(c) for c in list(range(0x0915, 0x093A)) + list(range(0x0958, 0x0960)) + [0x093C])
VEDIC = re.compile(r"[᳐-᳿꣠-ꣿ]")
OCR_CACHE = DATA / "ocr_cache"
SUBJECT = re.compile(r"विषय\s*[A-Za-z|:;\-—=]*\s*[:\-—]?\s*([^\n]{6,})")
OCR_WORKERS = int(os.environ.get("OCR_WORKERS", "8"))
BLOCKS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "br", "table", "ul", "ol", "section", "article"}

CHARTER_DEPARTMENTS = {
    "1_p_Tax": "Tax Collection", "2_water": "Water Supply", "3_sewarage": "Drainage", "4_tp": "Town Planning",
    "N_bp": "Building Permission & Unauthorised Construction Control", "5_encharocment": "Building Permission & Unauthorised Construction Control",
    "6_health": "Health", "7_garden": "Gardens", "8_Ele": "Electrical", "9_civil": "Civil Engineering",
    "11_skysign": "Zonal Office", "12_medical": "Medical", "13_schoolboard": "Primary Education",
    "14_secondery": "Secondary Education", "16_slum": "Slum Rehabilitation", "17_veternary": "Veterinary", "18_fire": "Fire",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def detect_language(text):
    dev, lat = len(DEVANAGARI.findall(text)), len(LATIN.findall(text))
    if dev + lat == 0:
        return "unknown"
    share = dev / (dev + lat)
    if share > 0.6:
        # PCMC publishes in Marathi; Hindi is rare. Distinguish with common function words.
        hi = len(re.findall(r"(?:^|\s)(है|हैं|में|और|नहीं|लिए|गया|किया)(?=\s|$)", text))
        mr = len(re.findall(r"(?:^|\s)(आहे|आहेत|व|आणि|मध्ये|करिता|यांचे|बाबत|येथे|करावा|करणे)(?=\s|$)|च्या|णेबाबत|ण्यात", text))
        return "hi" if hi > mr * 1.5 and hi > 3 else "mr"
    return "en" if share < 0.15 else "mixed"


def broken_devanagari(text):
    """PDFs exported from Word with non-Unicode-aware fonts: text *looks* Devanagari but the letter order is
    wrong ("पिंिंरी" for "पिंपरी") or it uses the wrong code points (Vedic signs, ऩ). Search would miss real words."""
    dev = DEVANAGARI.findall(text)
    matras = [m.start() for m in MATRA.finditer(text)]
    if len(matras) < 30:
        return False
    misplaced = sum(1 for i in matras if i == 0 or text[i - 1] not in CONSONANTS) / len(matras)
    wrong_points = len(VEDIC.findall(text)) > 0 or text.count("ऩ") / max(1, len(dev)) > 0.002
    name_mangled = "महानगर" in text and not ("पिंपरी" in text or "चिंचवड" in text)
    return misplaced > 0.04 or wrong_points or name_mangled


def text_quality(text, pages):
    """good | scanned | legacy_font | broken_unicode | broken_devanagari | empty"""
    stripped = re.sub(r"\s+", "", text)
    if not stripped:
        return "empty" if pages == 0 else "scanned"
    if len(stripped) / max(pages, 1) < 60:
        return "scanned"
    dev, odd = len(DEVANAGARI.findall(text)), len(ODD.findall(text))
    if dev and odd / (dev + odd) > 0.02:
        return "broken_unicode"
    # Shree-Lipi / DV-TT style fonts exported as Latin-1 accented letters ("¨É½þÉ®úÉ")
    latin1 = len(re.findall(r"[ -ÿ]", text))
    if latin1 > 100 and latin1 / max(1, len(stripped)) > 0.15:
        return "legacy_font"
    letters = LATIN.findall(text)
    if len(letters) > 200 and dev < len(letters) * 0.1:
        words = re.findall(r"[A-Za-z]{3,}", text)
        q_ratio = text.count("q") / len(letters)
        mixed = sum(1 for w in words if MIXED_CASE.search(w)) / max(len(words), 1)
        vowels = sum(1 for ch in letters if ch.lower() in "aeiou") / len(letters)
        if q_ratio > 0.015 or mixed > 0.15 or vowels < 0.22:
            return "legacy_font"
    if broken_devanagari(text):
        return "broken_devanagari"
    return "good"


# ---------------- HTML ----------------
def html_to_text(node):
    """Flatten HTML into lines: block elements become new lines, table cells joined with ' | '."""
    out = []

    def walk(el):
        if isinstance(el, Comment):
            return
        if isinstance(el, NavigableString):
            out.append(str(el))
            return
        if el.name in ("script", "style", "noscript", "form", "select", "button", "svg", "iframe"):
            return
        if el.name == "tr":
            cells = [" ".join(td.get_text(" ", strip=True).split()) for td in el.find_all(["td", "th"])]
            out.append("\n" + " | ".join(c for c in cells if c) + "\n")
            return
        if el.name in ("h1", "h2", "h3", "h4", "h5"):
            out.append("\n## " + " ".join(el.get_text(" ", strip=True).split()) + "\n")
            return
        if el.name == "a" and el.get("href", "").lower().endswith(".pdf"):
            out.append(f" {el.get_text(' ', strip=True)} ")
            return
        block = el.name in BLOCKS
        if block:
            out.append("\n")
        for child in el.children:
            walk(child)
        if block:
            out.append("\n")

    walk(node)
    lines = [" ".join(line.split()) for line in "".join(out).split("\n")]
    cleaned = []
    for line in lines:
        if line and (not cleaned or cleaned[-1] != line):
            cleaned.append(line)
    return cleaned


def parse_html(path):
    soup = BeautifulSoup(path.read_bytes().decode("utf-8", "ignore"), "lxml")
    main = soup.select_one("main#content") or soup.body or soup
    for sel in [".post-details", ".side-section", ".breadcrumb", ".breadcrumbs", ".page-title", ".carousel", ".yearDropdown", ".pagination", "nav"]:
        for el in main.select(sel):
            el.decompose()
    heading = main.select_one("h2.sub-heading") or main.find(["h1", "h2"])
    title = " ".join(heading.get_text(" ", strip=True).split()) if heading else (soup.title.get_text(strip=True) if soup.title else "")
    pdf_links = []
    for a in main.find_all("a", href=True):
        if a["href"].lower().endswith(".pdf"):
            label = " ".join(a.get_text(" ", strip=True).split()) or " ".join((a.get("aria-label") or "").split())
            pdf_links.append({"url": normalize(a["href"], "https://www.pcmcindia.gov.in/"), "text": label.replace(" contains pdf opens a new window", "")})
    return title, html_to_text(main), pdf_links


# ---------------- PDF ----------------
TESSERACT_CANDIDATES = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "tesseract-env" / "Library" / "bin" / "tesseract.exe",   # conda-forge, no admin
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
]
TESSDATA_BEST = Path(os.environ.get("LOCALAPPDATA", "")) / "tesseract-env" / "share" / "tessdata_best"
OCR_CONFIG = ""


def tesseract_available():
    global OCR_CONFIG
    import pytesseract
    exe = shutil.which("tesseract") or next((str(p) for p in TESSERACT_CANDIDATES if p.exists()), None)
    if not exe:
        return False
    pytesseract.pytesseract.tesseract_cmd = exe
    if (TESSDATA_BEST / "mar.traineddata").exists():
        OCR_CONFIG = f"--tessdata-dir {TESSDATA_BEST.as_posix()}"  # path has no spaces; quotes break on Windows
    return True


def page_text(data):
    """Rebuild lines from image_to_data output (avoids a second OCR pass)."""
    lines = {}
    for i, word in enumerate(data["text"]):
        if word.strip() and float(data["conf"][i]) >= 0:
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            lines.setdefault(key, []).append(word)
    return "\n".join(" ".join(ws) for _, ws in sorted(lines.items()))


def ocr_pdf(doc, max_pages=40):
    import pytesseract
    from PIL import Image

    texts, confs = [], []
    for page in list(doc)[:max_pages]:
        pix = page.get_pixmap(dpi=300)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        data = pytesseract.image_to_data(img, lang="mar+eng", config=OCR_CONFIG, output_type=pytesseract.Output.DICT)
        words = [(w, float(c)) for w, c in zip(data["text"], data["conf"]) if w.strip() and float(c) >= 0]
        confs.extend(c for _, c in words)
        texts.append(page_text(data))
    return "\n\n".join(texts), (round(sum(confs) / len(confs) / 100, 3) if confs else 0.0)


def ocr_job(path_str):
    """Worker: OCR one PDF and cache the result next to the raw files (keyed by raw file name = URL hash)."""
    os.environ["OMP_THREAD_LIMIT"] = "1"   # one core per worker; parallelism comes from the pool
    tesseract_available()
    path = Path(path_str)
    doc = pymupdf.open(path)
    text, conf = ocr_pdf(doc)
    (OCR_CACHE / f"{path.stem}.json").write_text(json.dumps({"text": text, "confidence": conf, "pages": len(doc)},
                                                            ensure_ascii=False), encoding="utf-8")
    return path.name, len(doc), conf


def run_ocr(paths):
    from concurrent.futures import ProcessPoolExecutor, as_completed
    OCR_CACHE.mkdir(exist_ok=True)
    todo = [p for p in paths if not (OCR_CACHE / f"{p.stem}.json").exists()]
    print(f"OCR: {len(todo)} PDFs to process ({len(paths) - len(todo)} cached), {OCR_WORKERS} workers", flush=True)
    with ProcessPoolExecutor(max_workers=OCR_WORKERS) as pool:
        futures = {pool.submit(ocr_job, str(p)): p for p in todo}
        for n, fut in enumerate(as_completed(futures), 1):
            try:
                name, pages, conf = fut.result()
                print(f"  [{n}/{len(todo)}] {name} {pages}p conf={conf}", flush=True)
            except Exception as err:
                print(f"  [{n}/{len(todo)}] {futures[fut].name} failed: {err}", flush=True)


def parse_pdf(path, allow_ocr):
    doc = pymupdf.open(path)
    pages = len(doc)
    text = "\n\n".join(page.get_text() for page in doc)
    quality = text_quality(text, pages)
    info = {"pages": pages, "extraction_method": "pdf_text", "text_quality": quality, "ocr_confidence": None,
            "needs_ocr": quality in ("scanned", "legacy_font", "broken_unicode", "broken_devanagari")}
    cached = OCR_CACHE / f"{path.stem}.json"
    if info["needs_ocr"] and cached.exists():   # OCR results are cached per raw file
        result = json.loads(cached.read_text(encoding="utf-8"))
        ocr_text, conf = result["text"], result["confidence"]
        if ocr_text.strip():
            text = ocr_text
            info.update(extraction_method="ocr", ocr_confidence=conf, needs_ocr=False,
                        text_quality="ocr_good" if conf >= 0.8 else "ocr_low")
    meta_title = (doc.metadata or {}).get("title") or ""
    lines = [" ".join(l.split()) for l in text.split("\n")]
    return meta_title, [l for l in lines if l], info


# ---------------- main ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ocr", action="store_true", help="OCR scanned / garbled PDFs (needs Tesseract with mar+hin)")
    args = ap.parse_args()
    allow_ocr = args.ocr and tesseract_available()
    if args.ocr and not allow_ocr:
        print("Tesseract not found - PDFs needing OCR will be flagged, not OCR'd")

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    circulars = {c["pdf_url"]: c for c in json.loads(CIRCULARS_PATH.read_text(encoding="utf-8"))} if CIRCULARS_PATH.exists() else {}
    previous = {}
    if DOCS_PATH.exists():
        for line in DOCS_PATH.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            previous[d["doc_id"]] = d

    if allow_ocr:
        need = []
        for rec in index.values():
            if rec.get("status") == 200 and (rec.get("raw_path") or "").endswith(".pdf"):
                path = DATA / rec["raw_path"]
                try:
                    doc = pymupdf.open(path)
                    if text_quality("\n\n".join(pg.get_text() for pg in doc), len(doc)) != "good":
                        need.append(path)
                except Exception:
                    pass
        run_ocr(need)

    parsed = []
    for key, rec in index.items():
        if rec.get("status") != 200 or not rec.get("raw_path"):
            continue
        path = DATA / rec["raw_path"]
        doc_id = hashlib.sha1(key.encode()).hexdigest()[:16]
        old = previous.get(doc_id)
        if old and old.get("sha256") == rec["sha256"] and old.get("extraction_method") == "ocr":
            parsed.append({**old, "lines": old["text"].split("\n")})   # OCR is slow; reuse while the file is unchanged
            continue
        try:
            if path.suffix == ".pdf":
                title, lines, info = parse_pdf(path, allow_ocr)
                pdf_links = []
            else:
                title, lines, pdf_links = parse_html(path)
                info = {"pages": None, "extraction_method": "html", "text_quality": "good", "ocr_confidence": None, "needs_ocr": False}
        except Exception as err:  # corrupt file etc. - keep a record so the report shows it
            title, lines, pdf_links = "", [], []
            info = {"pages": None, "extraction_method": "failed", "text_quality": f"error:{type(err).__name__}", "ocr_confidence": None, "needs_ocr": False}

        circ = circulars.get(rec["url"], {})
        department = rec.get("department")
        department = CHARTER_DEPARTMENTS.get(department, department)
        parsed.append({
            "doc_id": doc_id, "url": rec["url"], "session_lang": rec.get("lang"),
            "title": rec.get("title") or circ.get("title") or title,
            "category": rec.get("category"), "doc_type": "circular" if rec.get("category") == "circular" else ("pdf" if path.suffix == ".pdf" else "page"),
            "department": department, "authority_level": rec.get("authority"),
            "published_date": rec.get("published_date") or circ.get("published_date"),
            "ref_no": rec.get("ref_no") or circ.get("ref_no"), "doc_kind": rec.get("doc_kind") or circ.get("doc_kind"),
            "effective_from": None, "effective_until": None, "status": "active", "supersedes": None, "superseded_by": None,
            "verified": False, "lines": lines, "pdf_links": pdf_links, **info,
            "sha256": rec["sha256"], "changed": rec.get("changed", False), "fetched_at": rec["fetched_at"],
            "first_seen": rec.get("first_seen"), "extracted_at": now_iso(),
        })

    # PDFs rarely carry a title; the official page that links them names the service ("नळ कनेक्शन मंजुरी"),
    # in Marathi and (via the English toggle) in English. Generic link texts like "Download" are ignored.
    generic = {"download", "view", "pdf", "click here", "येथे क्लिक करा", "पहा", "डाउनलोड", "आदेश", "परिपत्रक", "more"}
    link_titles = {}
    for d in parsed:
        for link in d.get("pdf_links") or []:
            text = link["text"].strip(" .:-|")
            if len(text) >= 4 and text.lower() not in generic and not text.lower().startswith("http"):
                link_titles.setdefault(link["url"], {}).setdefault("en" if d["session_lang"] == "engish" and not DEVANAGARI.search(text) else "mr", text)
    for d in parsed:
        if d["doc_type"] == "page":
            continue
        names = link_titles.get(d["url"])
        weak = (not d["title"] or len(d["title"]) < 4 or d["title"].lower().endswith((".doc", ".pdf"))
                or d["title"].startswith(("पिंपरी चिंचवड", "Microsoft Word")) or d["category"] == "citizen_charter")
        if names and weak:
            d["title"] = names.get("mr") or names.get("en")
        elif weak:
            # Charters state their service on a "विषय" (subject) line, e.g. "२) विषय : मिळकतीचे हस्तांतरण वारसा हक्काने".
            m = SUBJECT.search("\n".join(d["lines"][:40]))
            if m:
                d["title"] = m.group(1).strip(" .:-|")[:90]
        if names:
            d["title_en"] = names.get("en")

    # Lines repeated across many HTML pages are template boilerplate (menus, footers, sidebars).
    html_docs = [d for d in parsed if d["extraction_method"] == "html"]
    freq = Counter(line for d in html_docs for line in set(d["lines"]))
    threshold = max(4, int(len(html_docs) * 0.25))
    boiler = {line for line, n in freq.items() if n >= threshold}

    seen_text = {}
    with DOCS_PATH.open("w", encoding="utf-8") as out:
        for d in parsed:
            lines = [l for l in d["lines"] if l not in boiler] if d["extraction_method"] == "html" else d["lines"]
            text = "\n".join(lines).strip()
            d["text"] = text
            d["chars"] = len(text)
            d["language"] = detect_language(text)
            norm = hashlib.sha1(re.sub(r"\W+", "", text).encode()).hexdigest()
            d["content_hash"] = norm
            d["duplicate_of"] = seen_text.get(norm) if text else None
            seen_text.setdefault(norm, d["doc_id"])
            d.pop("lines", None)
            out.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"{len(parsed)} documents -> {DOCS_PATH} ({len(boiler)} boilerplate lines removed)")


if __name__ == "__main__":
    main()
