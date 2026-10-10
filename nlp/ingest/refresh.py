"""Weekly refresh of the knowledge base: re-crawl, extract, chunk, re-embed, and report what changed.
Each step runs as its own process (same commands as the README), so a failure stops the run cleanly
and the chatbot keeps answering from the previous index. The change report lists new, changed and
removed documents so an officer can review them on the Knowledge base page.
Usage:  python -m ingest.refresh [--limit N]
Output: data/crawl/refresh_report.json
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .crawler import DATA
from .extract import DOCS_PATH, tesseract_available

REPORT_PATH = DATA / "refresh_report.json"
NLP_DIR = Path(__file__).resolve().parent.parent
MAX_CHANGES = 200


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def snapshot():
    """doc_id -> what an officer needs to recognise the document, plus its content hash."""
    docs = {}
    if DOCS_PATH.exists():
        for line in DOCS_PATH.read_text(encoding="utf-8").splitlines():
            d = json.loads(line)
            docs[d["doc_id"]] = {"hash": d.get("content_hash") or d.get("sha256"), "title": d.get("title"),
                                 "url": d.get("url"), "category": d.get("category"), "doc_type": d.get("doc_type")}
    return docs


def diff(before, after):
    pick = lambda d, i: {"doc_id": i, **{k: v for k, v in d.items() if k != "hash"}}
    added = [pick(after[i], i) for i in after if i not in before]
    removed = [pick(before[i], i) for i in before if i not in after]
    changed = [pick(after[i], i) for i in after if i in before and after[i]["hash"] != before[i]["hash"]]
    return {"added": added[:MAX_CHANGES], "changed": changed[:MAX_CHANGES], "removed": removed[:MAX_CHANGES],
            "counts": {"added": len(added), "changed": len(changed), "removed": len(removed), "total": len(after)}}


def load_report():
    try:
        return json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_report(report):
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


def run(limit=None, trigger="manual", on_progress=None):
    steps = [
        ("crawl", ["ingest.crawler", "--refresh-days", "7"] + (["--limit", str(limit)] if limit else [])),
        ("extract", ["ingest.extract"] + (["--ocr"] if tesseract_available() else [])),
        ("translate_titles", ["ingest.translate_titles"]),
        ("chunk", ["ingest.chunk"]),
        ("index", ["ingest.index"]),
        ("report", ["ingest.report"]),
    ]
    before = snapshot()
    report = {"trigger": trigger, "startedAt": now(), "finishedAt": None, "ok": False, "steps": [], "reviewed": False}
    save_report({**(load_report() or {}), "running": True, "current": report})
    for name, args in steps:
        if on_progress:
            on_progress(name)
        t0 = time.time()
        proc = subprocess.run([sys.executable, "-m", *args], cwd=NLP_DIR, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=6 * 3600)
        step = {"name": name, "ok": proc.returncode == 0, "seconds": round(time.time() - t0, 1)}
        if proc.returncode != 0:
            step["error"] = (proc.stderr or proc.stdout).strip()[-600:]
        report["steps"].append(step)
        if proc.returncode != 0:
            break
    report["ok"] = all(s["ok"] for s in report["steps"]) and len(report["steps"]) == len(steps)
    report["finishedAt"] = now()
    report.update(diff(before, snapshot()))
    previous = load_report() or {}
    history = ([{k: previous[k] for k in ("startedAt", "finishedAt", "ok", "counts", "trigger") if k in previous}]
               if previous.get("finishedAt") else []) + previous.get("history", [])
    report["history"] = history[:10]
    save_report(report)
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    r = run(limit=ap.parse_args().limit)
    print(json.dumps({k: r[k] for k in ("ok", "counts", "steps")}, indent=1))
