"""Summarise the crawl for human review: what was collected, its quality, and what needs a decision.

Usage:  python -m ingest.report
Output: data/crawl/inventory.md and data/crawl/inventory.csv
"""
import csv
import json
from collections import Counter, defaultdict

from .crawler import DATA, INDEX_PATH, CIRCULARS_PATH, EXTERNAL_PATH
from .extract import DOCS_PATH, tesseract_available


def load_jsonl(path):
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def table(rows, headers):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def main():
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    docs = load_jsonl(DOCS_PATH)
    circulars = json.loads(CIRCULARS_PATH.read_text(encoding="utf-8")) if CIRCULARS_PATH.exists() else []
    external = json.loads(EXTERNAL_PATH.read_text(encoding="utf-8")) if EXTERNAL_PATH.exists() else {}

    usable = [d for d in docs if not d["duplicate_of"] and d["chars"] >= 80 and not d["needs_ocr"]]
    needs_ocr = [d for d in docs if d["needs_ocr"]]
    errors = [r for r in index.values() if r.get("status") != 200]
    total_mb = sum(r.get("bytes", 0) for r in index.values() if r.get("status") == 200) / 1e6

    by_cat = defaultdict(Counter)
    for d in docs:
        c = by_cat[d["category"]]
        c["docs"] += 1
        c["usable"] += d in usable
        c["needs_ocr"] += d["needs_ocr"]
        c["duplicate"] += bool(d["duplicate_of"])
        c["chars"] += d["chars"] if d in usable else 0

    lines = [
        "# PCMC crawl inventory",
        "",
        f"- Fetched documents: **{sum(1 for r in index.values() if r.get('status') == 200)}** ({total_mb:.1f} MB)",
        f"- Usable now (clean text, not duplicate, >= 80 chars): **{len(usable)}** "
        f"(~{sum(d['chars'] for d in usable) / 1000:.0f}k characters)",
        f"- Waiting for OCR: **{len(needs_ocr)}** (Tesseract installed: {'yes' if tesseract_available() else 'no'})",
        f"- Duplicates (English page identical to Marathi, etc.): {sum(1 for d in docs if d['duplicate_of'])}",
        f"- Failed / skipped fetches: {len(errors)}",
        "",
        "## By category",
        table([(cat, c["docs"], c["usable"], c["needs_ocr"], c["duplicate"], f"{c['chars'] / 1000:.0f}k")
               for cat, c in sorted(by_cat.items(), key=lambda kv: -kv[1]["docs"])],
              ["category", "docs", "usable", "needs OCR", "duplicate", "usable text"]),
        "",
        "## Text quality",
        table(sorted(Counter(d["text_quality"] for d in docs).items(), key=lambda kv: -kv[1]), ["quality", "docs"]),
        "",
        "## Language (usable docs)",
        table(sorted(Counter(d["language"] for d in usable).items(), key=lambda kv: -kv[1]), ["language", "docs"]),
        "",
    ]

    if circulars:
        rel = [c for c in circulars if c["relevant"]]
        years = Counter(c["listed_year"] for c in circulars)
        lines += [
            "## Circular archive",
            f"- Listed: {len(circulars)} ({', '.join(f'{y}: {n}' for y, n in sorted(years.items()))})",
            f"- Citizen-relevant by title filter (downloaded): {len(rel)}; skipped as internal/HR: {len(circulars) - len(rel)}",
            "",
            "Sample of downloaded circulars:",
            "",
            table([(c["published_date"], c["ref_no"][:30], c["title"][:90]) for c in sorted(rel, key=lambda c: c["published_date"] or "", reverse=True)[:25]],
                  ["date", "ref no", "title"]),
            "",
        ]

    if needs_ocr:
        lines += ["## Needs OCR", table(sorted(Counter((d["category"], d["text_quality"]) for d in needs_ocr).items(), key=lambda kv: -kv[1]),
                                        ["category / reason", "docs"]).replace("('", "").replace("')", "").replace("', '", " / "), ""]

    if external:
        lines += ["## External sites linked from PCMC pages (not crawled - need your decision)",
                  table([(host, v["count"], "; ".join(a for a in v["anchors"][:3] if a)[:80], v["examples"][0][:80])
                         for host, v in list(external.items())[:40]], ["host", "links", "link text", "example"]), ""]

    if errors:
        lines += ["## Failed / skipped", table([(r.get("status"), r["url"][:100]) for r in errors[:40]], ["status", "url"]), ""]

    (DATA / "inventory.md").write_text("\n".join(lines), encoding="utf-8")
    with (DATA / "inventory.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["doc_id", "category", "department", "title", "url", "session_lang", "language", "doc_type", "published_date",
                    "ref_no", "pages", "chars", "extraction_method", "text_quality", "needs_ocr", "duplicate_of", "authority_level", "fetched_at"])
        for d in docs:
            w.writerow([d["doc_id"], d["category"], d["department"], d["title"], d["url"], d["session_lang"], d["language"], d["doc_type"],
                        d["published_date"], d["ref_no"], d["pages"], d["chars"], d["extraction_method"], d["text_quality"],
                        d["needs_ocr"], d["duplicate_of"], d["authority_level"], d["fetched_at"]])
    print("\n".join(lines[:12]))


if __name__ == "__main__":
    main()
