"""Split extracted documents into retrieval chunks with full provenance metadata.

- Chunks follow the document's own structure: a new chunk starts at a heading, and long sections
  are cut on line boundaries (~1200 characters, 1 line of overlap). Table rows are never split.
- Every chunk is prefixed with "title > section" so it is understandable on its own.
- The hand-verified entries in knowledge/pcmc_kb.json (and the zone table) become authority level 0.
- Devanagari digits are normalised to ASCII in `search_text` so "७ दिवस" and "7 days" match the same number.

Usage:  python -m ingest.chunk
Output: data/crawl/chunks.jsonl
"""
import hashlib
import json
import re
from datetime import date

from .crawler import DATA
from .extract import DOCS_PATH

CHUNKS_PATH = DATA / "chunks.jsonl"
MAX_CHARS = 1200
MIN_CHARS = 80
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
DATE_IN_TEXT = re.compile(r"(?:दिनांक|दि\.|dated|date)\s*[:\-]?\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})", re.I)

CATEGORY_TOPIC = {
    "Tax Collection": "property_tax", "Water Supply": "water", "Drainage": "drainage",
    "Building Permission & Unauthorised Construction Control": "building_permission", "Electrical": "street_lights",
    "Civil Engineering": "roads",
}


def normalise_digits(text):
    return text.translate(DEVANAGARI_DIGITS)


def date_from_text(text):
    """First explicit 'दिनांक dd/mm/yyyy' in the document header, if any (source: extracted_from_text)."""
    m = DATE_IN_TEXT.search(normalise_digits(text[:2500]))
    if not m:
        return None
    d, mth, y = (int(x) for x in m.groups())
    try:
        return date(y, mth, d).isoformat() if 2000 <= y <= date.today().year else None
    except ValueError:
        return None


def split_sections(text):
    """Yield (heading, lines) groups; a '## ' line starts a new section."""
    heading, lines = None, []
    for line in text.split("\n"):
        if line.startswith("## "):
            if lines:
                yield heading, lines
            heading, lines = line[3:].strip(), []
        elif line.strip():
            lines.append(line)
    if lines:
        yield heading, lines


def pack(lines, max_chars=MAX_CHARS):
    """Group lines into pieces of at most max_chars, repeating the last line of the previous piece."""
    piece, size = [], 0
    for line in lines:
        if piece and size + len(line) > max_chars:
            yield piece
            piece = piece[-1:] if len(piece[-1]) < 300 else []
            size = sum(len(l) for l in piece)
        piece.append(line)
        size += len(line) + 1
    if piece:
        yield piece


TRANSLATIONS_PATH = DATA / "title_translations.json"
TITLE_TRANSLATIONS = json.loads(TRANSLATIONS_PATH.read_text(encoding="utf-8")) if TRANSLATIONS_PATH.exists() else {}


def document_chunks(doc):
    title = (doc["title"] or "").strip()
    title_en, title_en_source = doc.get("title_en"), "official" if doc.get("title_en") else None
    if not title_en and title in TITLE_TRANSLATIONS:
        title_en, title_en_source = TITLE_TRANSLATIONS[title], "machine"   # search aid only, never shown as official
    display_title = title
    if title_en and title_en != title:
        title = f"{title} ({title_en})" if title else title_en
    if doc["category"] == "citizen_charter":
        title = f"नागरिकांची सनद / Citizen charter - {doc['department'] or ''}: {title}".replace(" : ", ": ")
    published = doc.get("published_date")
    date_source = "official_listing" if published else None
    if not published and doc["doc_type"] in ("pdf", "circular"):
        published = date_from_text(doc["text"])
        date_source = "extracted_from_text" if published else None

    sections = list(split_sections(doc["text"]))
    chunks = []
    for heading, lines in sections:
        for piece in pack(lines):
            body = "\n".join(piece)
            if len(body) < MIN_CHARS and len(sections) > 1:
                continue
            context = " > ".join(x for x in [title, heading if heading and heading != title else None] if x)
            text = f"{context}\n{body}" if context else body
            chunks.append({
                "chunk_id": hashlib.sha1(f"{doc['doc_id']}|{len(chunks)}|{body[:80]}".encode()).hexdigest()[:20],
                "doc_id": doc["doc_id"], "position": len(chunks),
                "text": text, "body": body, "search_text": normalise_digits(text),
                "title": display_title if title_en_source == "machine" else title, "title_en": title_en,
                "title_en_source": title_en_source, "section": heading,
                "url": doc["url"], "category": doc["category"], "doc_type": doc["doc_type"],
                "department": doc["department"], "topic": CATEGORY_TOPIC.get(doc["department"]),
                "language": doc["language"], "authority_level": doc["authority_level"] or 2,
                "verified": doc["verified"], "status": doc["status"],
                "published_date": published, "date_source": date_source, "ref_no": doc.get("ref_no"),
                "effective_from": doc["effective_from"], "effective_until": doc["effective_until"],
                "supersedes": doc["supersedes"], "superseded_by": doc["superseded_by"],
                "extraction_method": doc["extraction_method"], "ocr_confidence": doc["ocr_confidence"],
                "text_quality": doc["text_quality"], "fetched_at": doc["fetched_at"], "content_hash": doc["content_hash"],
            })
    return chunks


def curated_chunks():
    """Hand-verified KB entries + zone table: authority 0, verified."""
    from chat.retriever import retriever  # reuses the same KB + generated zone documents

    out = []
    for d in retriever.docs:
        text = f"{d['title']}\n{d['content']}"
        out.append({
            "chunk_id": f"kb-{d['id']}", "doc_id": f"kb-{d['id']}", "position": 0,
            "text": text, "body": d["content"], "search_text": normalise_digits(text + "\n" + " ".join(d.get("keywords", []))),
            "title": d["title"], "section": None, "url": d.get("sourceUrl"), "service_url": d.get("serviceUrl"),
            "service_label": d.get("serviceLabel"), "category": "curated", "doc_type": "curated",
            "department": None, "topic": d.get("topic"), "language": "en", "authority_level": 0,
            "verified": True, "status": "active", "published_date": None, "date_source": None, "ref_no": None,
            "effective_from": None, "effective_until": None, "supersedes": None, "superseded_by": None,
            "extraction_method": "manual", "ocr_confidence": None, "text_quality": "good",
            "fetched_at": d.get("lastVerified"), "content_hash": hashlib.sha1(text.encode()).hexdigest(),
        })
    return out


def main():
    docs = [json.loads(l) for l in DOCS_PATH.read_text(encoding="utf-8").splitlines()]
    usable = [d for d in docs if not d["duplicate_of"] and not d["needs_ocr"] and d["chars"] >= MIN_CHARS
              and d["status"] != "disabled" and d["text_quality"] != "empty" and not d["text_quality"].startswith("error")]
    chunks = curated_chunks()
    for d in usable:
        chunks.extend(document_chunks(d))
    with CHUNKS_PATH.open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"{len(usable)} documents -> {len(chunks)} chunks ({CHUNKS_PATH})")


if __name__ == "__main__":
    main()
