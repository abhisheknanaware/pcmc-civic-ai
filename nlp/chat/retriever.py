import json
import math
import os
import re
import sys
from collections import Counter

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_config import PCMC

_KB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "knowledge", "pcmc_kb.json")
_TOKEN = re.compile(r"[a-z0-9]+|[ऀ-ॿ]+")
_STOP = {"the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "my", "i", "how", "do", "can", "what",
         "where", "which", "with", "at", "by", "it", "be", "me", "you", "your", "this", "that", "from", "pcmc", "steps", "step",
         "process", "procedure", "please", "tell", "about", "get", "want", "need", "know", "there", "any", "online", "way",
         # Hindi / Marathi / Hinglish question and filler words, so relevance is judged on content words
         "kaise", "kasa", "kashi", "kase", "kahan", "kaha", "kuthe", "kya", "kay", "hai", "ahe", "aahe", "karu", "kare", "karna",
         "karaycha", "karayche", "bharu", "bharna", "bharaycha", "bharayche", "mujhe", "mala", "chahiye", "pahije", "se", "ka", "ki", "ke",
         "कसा", "कशी", "कसे", "कुठे", "काय", "आहे", "करायचा", "करायची", "भरायचा", "भरायची", "कैसे", "कहाँ", "कहां", "क्या", "है",
         "करें", "भरें", "मिलेगा", "मिळेल", "मुझे", "मला", "का", "की", "के", "से"}


def _tokens(text: str) -> list:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


def _zone_documents() -> list:
    """One entry per zonal office, built from the verified zone table in config/pcmc.json."""
    docs, overview = [], []
    for zone_id, z in PCMC["zones"].items():
        wards = ", ".join(str(w) for w in z["wards"])
        contact = ", ".join(x for x in [f"phone {z['phone']}" if z.get("phone") else "", f"email {z['email']}"] if x)
        overview.append(f"Zone {zone_id} ({z['name']}): wards {wards}")
        docs.append({
            "id": f"zone-{zone_id}",
            "topic": "ward_info",
            "title": f"Zone {zone_id} ({z['name']} / {z['mr']}) zonal office",
            "content": f"PCMC zonal office Zone {zone_id}, named {z['name']} ({z['mr']}), is located at {z['office']}. "
                       f"It covers prabhag (ward) numbers {wards}. Contact: {contact}.",
            "keywords": [f"zone {zone_id.lower()}", f"{zone_id.lower()} zone", z["name"].lower(), z["mr"], "zonal office",
                         "ward office", "kshetriya karyalay", "क्षेत्रीय कार्यालय", "prabhag", "प्रभाग"] + [f"ward {w}" for w in z["wards"]],
            "source": "PCMC regional offices page",
            "sourceUrl": "https://www.pcmcindia.gov.in/ward_info",
            "serviceUrl": "https://www.pcmcindia.gov.in/ward_info",
            "serviceLabel": "PCMC zonal offices",
            "lastVerified": "2026-09-26",
        })
    docs.append({
        "id": "zones-overview",
        "topic": "ward_info",
        "title": "PCMC zonal offices and wards",
        "content": "PCMC has 10 zonal offices covering 32 prabhag (electoral wards): " + "; ".join(overview) + ". "
                   "Which locality falls in which prabhag is published by PCMC; this assistant does not guess it.",
        "keywords": ["zones", "zonal offices", "ward list", "which ward", "which zone", "my ward", "prabhag", "प्रभाग", "क्षेत्रीय कार्यालय", "वार्ड"],
        "source": "PCMC regional offices page",
        "sourceUrl": "https://www.pcmcindia.gov.in/ward_info",
        "serviceUrl": "https://www.pcmcindia.gov.in/ward_info",
        "serviceLabel": "PCMC zonal offices",
        "lastVerified": "2026-09-26",
    })
    return docs


class Retriever:
    """BM25 over the verified knowledge base; keywords are weighted so short multilingual queries still match."""

    def __init__(self, k1: float = 1.4, b: float = 0.75):
        with open(_KB_PATH, encoding="utf-8") as f:
            self.docs = json.load(f)["documents"] + _zone_documents()
        self.k1, self.b = k1, b
        self.doc_tokens = [_tokens(" ".join([d["title"], d["content"]] + d["keywords"] * 3)) for d in self.docs]
        self.avg_len = sum(len(t) for t in self.doc_tokens) / len(self.doc_tokens)
        df = Counter(tok for toks in self.doc_tokens for tok in set(toks))
        n = len(self.docs)
        self.idf = {tok: math.log(1 + (n - c + 0.5) / (c + 0.5)) for tok, c in df.items()}
        self.term_freqs = [Counter(t) for t in self.doc_tokens]

    def _bm25(self, query_tokens: list, index: int) -> float:
        tf, length = self.term_freqs[index], len(self.doc_tokens[index])
        score = 0.0
        for tok in query_tokens:
            if tok in tf:
                f = tf[tok]
                score += self.idf[tok] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * length / self.avg_len))
        return score

    def search(self, query: str, topic: str = None, top_k: int = 3) -> list:
        query_tokens = _tokens(query)
        unique_terms = set(query_tokens)
        results = []
        for i, doc in enumerate(self.docs):
            score = self._bm25(query_tokens, i)
            if topic and doc["topic"] == topic:
                score = score * 1.3 + 2.0  # the model's topic judgement is a strong signal
            if score > 0:
                # Share of the question's content words found in the entry: "electricity bill" matching only "bill"
                # (water/property tax) scores 0.5 at most, which keeps unrelated entries from being used.
                coverage = len(unique_terms & set(self.term_freqs[i])) / len(unique_terms) if unique_terms else 0
                results.append({**doc, "score": round(score, 3), "coverage": round(coverage, 2)})
        results.sort(key=lambda d: d["score"], reverse=True)
        return results[:top_k]


retriever = Retriever()
