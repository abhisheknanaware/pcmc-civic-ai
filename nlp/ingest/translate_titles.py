"""Machine-translate Marathi document titles to English, for search only.

English questions ("property transfer after death") rarely match Marathi-only titles
("मिळकतीचे हस्तांतरण वारसा हक्काने"). The translated title is added to the chunk's search context and
marked `title_en_source = machine`; it is never shown to citizens as an official title.

Usage:  python -m ingest.translate_titles
Output: data/crawl/title_translations.json (cached; only new titles are translated)
"""
import json
import re

import httpx

from chat.chat_graph import CHAT_MODEL, KEEP_ALIVE, MODEL_OPTIONS, OLLAMA_URL
from .crawler import DATA
from .extract import DEVANAGARI, DOCS_PATH

TRANSLATIONS_PATH = DATA / "title_translations.json"
BATCH = 8

PROMPT = """Translate these Pimpri-Chinchwad Municipal Corporation (PCMC) document titles from Marathi to short, plain English.
Keep the meaning exact; do not add or guess words. Keep numbers, years and English words as they are.
Glossary (use exactly): मिळकत/मालमत्ता = property; मिळकत कर = property tax; नळ कनेक्शन = water connection;
दाखला = certificate; ना हरकत दाखला/नाहरकत दाखला = NOC; सनद = charter; क्षेत्रीय कार्यालय = zonal office;
zone letters: अ=A, ब=B, क=C, ड=D, इ=E, फ=F, ग=G, ह=H, ज=J, ल=L (e.g. "ल क्षेत्रीय कार्यालय" = "L zonal office");
विभाग = department; नगर सचिव = Municipal Secretary; आयुक्त = Commissioner; मंडप = pandal; उपसणे = emptying;
वृक्षसंवर्धन = tree conservation; वृक्ष तोड = tree cutting; दिवाबत्ती = street light; जलनिःसारण/ड्रेनेज = drainage;
हस्तांतरण = transfer; वारसा हक्क = inheritance; नुतनीकरण = renewal; परवाना = licence; आकाशचिन्ह = sky sign (hoarding);
अतिक्रमण = encroachment; स्थापत्य = civil engineering; लेखा = accounts; आरोग्य = health; अग्निशमन = fire brigade.
Return JSON: {"translations": ["...", "..."]} in the same order.

Titles:
"""


def main():
    cache = json.loads(TRANSLATIONS_PATH.read_text(encoding="utf-8")) if TRANSLATIONS_PATH.exists() else {}
    docs = [json.loads(l) for l in DOCS_PATH.read_text(encoding="utf-8").splitlines()]
    titles = sorted({d["title"].strip() for d in docs
                     if d.get("title") and not d.get("title_en") and DEVANAGARI.search(d["title"]) and not d["duplicate_of"]})
    todo = [t for t in titles if t not in cache]
    print(f"{len(titles)} Marathi titles, {len(todo)} to translate")
    for i in range(0, len(todo), BATCH):
        part = todo[i:i + BATCH]
        body = "\n".join(f"{n + 1}. {t}" for n, t in enumerate(part))
        r = httpx.post(f"{OLLAMA_URL}/api/chat", timeout=180, json={
            "model": CHAT_MODEL, "stream": False, "think": False, "keep_alive": KEEP_ALIVE, "format": "json",
            "options": {**MODEL_OPTIONS, "temperature": 0, "num_predict": 60 * len(part)},
            "messages": [{"role": "user", "content": PROMPT + body}],
        })
        r.raise_for_status()
        try:
            out = json.loads(r.json()["message"]["content"]).get("translations", [])
        except (json.JSONDecodeError, AttributeError):
            out = []
        if len(out) != len(part):
            print(f"  batch {i // BATCH + 1}: got {len(out)} for {len(part)}, skipped")
            continue
        for mr, en in zip(part, out):
            en = re.sub(r"^\d+\.\s*", "", str(en)).strip()
            if en and not DEVANAGARI.search(en):
                cache[mr] = en
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}  e.g. {part[0][:40]} -> {cache.get(part[0], '?')[:50]}", flush=True)
        TRANSLATIONS_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    TRANSLATIONS_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(cache)} translations cached")


if __name__ == "__main__":
    main()
