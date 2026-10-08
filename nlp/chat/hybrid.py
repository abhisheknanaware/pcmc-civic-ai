"""Hybrid, time-aware retrieval over the crawled + curated PCMC knowledge base.

query -> time scope (current / year / specific circular)
      -> hard filters (disabled; superseded/historical when asking about current rules)
      -> vector search (bge-m3) + keyword search (BM25), merged with reciprocal rank fusion
      -> re-ranker (bge-reranker-v2-m3) on the best candidates
      -> authority / freshness / extraction-quality adjustments
      -> conflict check on amounts and time limits
      -> confidence HIGH / MEDIUM / LOW

The chunks are loaded from the local Qdrant store into memory at startup and the store is released
straight away, so the ingestion job can update it while the service runs (then call reload()).
"""
import json
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from datetime import date, datetime

import numpy as np

from chat.embeddings import embed
from chat.retriever import _tokens

logger = logging.getLogger(__name__)

NLP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QDRANT_PATH = os.path.join(NLP_ROOT, "data", "qdrant")
COLLECTION = "pcmc_kb"
# Officer decisions from the knowledge-base admin page (verify / disable / supersede), applied on every load.
OVERRIDES_PATH = os.path.join(NLP_ROOT, "data", "kb_overrides.json")
DOC_STATUSES = ("active", "disabled", "superseded")
RERANK_MODEL = os.getenv("KB_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
CANDIDATES = int(os.getenv("KB_CANDIDATES", "30"))
RERANK_TOP = int(os.getenv("KB_RERANK_TOP", "12"))
# The cross-encoder costs ~0.5 s per candidate on CPU, so it is opt-in (KB_RERANK=1, sensible with a CUDA build of torch).
USE_RERANKER = os.getenv("KB_RERANK", "0") == "1"
# bge-m3 cosine calibration from eval/kb_eval.py: relevant PCMC matches score ~0.50-0.70, unrelated questions < 0.47.
COS_LOW, COS_HIGH = float(os.getenv("KB_COS_LOW", "0.47")), float(os.getenv("KB_COS_HIGH", "0.60"))

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
YEAR = re.compile(r"\b(20[0-3]\d)\b")
HISTORICAL = re.compile(r"\b(was|were|previous|previously|earlier|old|last year|used to|pehle|pahile|purvi)\b|पूर्वी|मागील|जुन्या|पहले|पिछले", re.I)
SPECIFIC_DOC = re.compile(r"(circular|notification|order|परिपत्रक|आदेश|अधिसूचना)\s*(no\.?|number|क्र|क्रमांक)?\s*[:\-]?\s*[\w/]*\d", re.I)
CURRENT = re.compile(r"\b(current|currently|now|latest|today|this year|new|abhi|aata|sadhya)\b|सध्या|आता|चालू|नवीन|अभी|वर्तमान", re.I)
AMOUNT = re.compile(r"(?:₹|rs\.?|inr|रु\.?|रुपये)\s*([\d,]+(?:\.\d+)?)", re.I)
DAYS = re.compile(r"([\d]+)\s*(?:working\s*days|days|दिवस|कार्यालयीन दिवस|दिवसात|दिन)", re.I)


def normalise(text):
    return text.translate(DEVANAGARI_DIGITS)


def time_scope(query):
    """CURRENT (default) | YEAR | SPECIFIC_DOCUMENT, plus the referenced year if any."""
    q = normalise(query)
    years = [int(y) for y in YEAR.findall(q) if 2000 <= int(y) <= date.today().year]
    if SPECIFIC_DOC.search(q):
        return "SPECIFIC_DOCUMENT", (years[0] if years else None)
    if years and (HISTORICAL.search(q) or years[0] < date.today().year):
        return "YEAR", years[0]
    if HISTORICAL.search(q) and not CURRENT.search(q):
        return "HISTORICAL", None
    return "CURRENT", None


class HybridRetriever:
    def __init__(self):
        self._lock = threading.Lock()
        self.ready = False
        self.chunks, self.vectors = [], None
        self.reranker = None

    # ---------------- loading ----------------
    def load(self):
        from qdrant_client import QdrantClient

        started = time.time()
        client = QdrantClient(path=QDRANT_PATH)
        try:
            if not client.collection_exists(COLLECTION):
                logger.warning("KB collection missing - run python -m ingest.index")
                return False
            chunks, vectors, offset = [], [], None
            while True:
                points, offset = client.scroll(COLLECTION, limit=512, offset=offset, with_payload=True, with_vectors=True)
                for p in points:
                    chunks.append(p.payload)
                    vectors.append(p.vector)
                if offset is None:
                    break
        finally:
            client.close()  # release the file lock for the ingestion job

        tokens = [_tokens(normalise(c["search_text"])) for c in chunks]
        df = Counter(t for toks in tokens for t in set(toks))
        n = len(chunks)
        with self._lock:
            self.chunks = chunks
            self.vectors = np.asarray(vectors, dtype=np.float32)
            self.tf = [Counter(t) for t in tokens]
            self.by_doc = {}
            for c in sorted(chunks, key=lambda c: c.get("position", 0)):
                self.by_doc.setdefault(c["doc_id"], []).append(c)
            self.lengths = np.array([len(t) for t in tokens], dtype=np.float32)
            self.avg_len = float(self.lengths.mean()) if n else 1.0
            self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
            if USE_RERANKER and self.reranker is None:
                from sentence_transformers import CrossEncoder
                self.reranker = CrossEncoder(RERANK_MODEL, device="cpu", max_length=384)
            for doc_id, decision in self._read_overrides().items():
                self._apply(doc_id, decision)
            self.ready = True
        logger.info(f"Hybrid KB loaded: {n} chunks in {time.time() - started:.1f}s")
        return True

    reload = load

    # ---------------- officer review (knowledge-base admin) ----------------
    @staticmethod
    def _read_overrides():
        try:
            with open(OVERRIDES_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def _apply(self, doc_id, decision):
        for c in self.by_doc.get(doc_id, []):
            if "status" in decision:
                c["status"] = decision["status"]
            if "verified" in decision:
                c["verified"] = bool(decision["verified"])

    def set_document_review(self, doc_id, status=None, verified=None, reviewer=None):
        """Record an officer's decision; takes effect immediately and survives reloads/re-indexing."""
        if doc_id not in self.by_doc:
            raise KeyError(doc_id)
        if status is not None and status not in DOC_STATUSES:
            raise ValueError("status must be one of " + ", ".join(DOC_STATUSES))
        overrides = self._read_overrides()
        decision = overrides.get(doc_id, {})
        if status is not None:
            decision["status"] = status
        if verified is not None:
            decision["verified"] = bool(verified)
        decision.update(reviewed_by=reviewer, reviewed_at=datetime.now().isoformat(timespec="seconds"))
        overrides[doc_id] = decision
        tmp = OVERRIDES_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(overrides, f, ensure_ascii=False, indent=1)
        os.replace(tmp, OVERRIDES_PATH)
        with self._lock:
            self._apply(doc_id, decision)
        return self.document_summary(doc_id, overrides)

    def document_summary(self, doc_id, overrides=None):
        chunks = self.by_doc.get(doc_id, [])
        if not chunks:
            return None
        first = chunks[0]
        review = (overrides if overrides is not None else self._read_overrides()).get(doc_id, {})
        return {
            "id": doc_id, "title": first.get("title") or first.get("section") or "PCMC", "titleEn": first.get("title_en"),
            "url": first.get("url"), "category": first.get("category"), "department": first.get("department"),
            "language": first.get("language"), "extraction": first.get("extraction_method"),
            "ocrConfidence": first.get("ocr_confidence"), "authorityLevel": first.get("authority_level"),
            "publishedDate": first.get("published_date"), "fetchedAt": (first.get("fetched_at") or "")[:10],
            "status": first.get("status") or "active", "verified": bool(first.get("verified")), "chunks": len(chunks),
            "chars": sum(len(c.get("body") or c.get("text") or "") for c in chunks),
            "preview": (first.get("body") or first.get("text") or "")[:220],
            "reviewedBy": review.get("reviewed_by"), "reviewedAt": review.get("reviewed_at"),
        }

    def documents(self):
        overrides = self._read_overrides()
        return [self.document_summary(doc_id, overrides) for doc_id in self.by_doc]

    # ---------------- scoring pieces ----------------
    def _bm25(self, query_tokens, idx, k1=1.4, b=0.75):
        tf, length = self.tf[idx], self.lengths[idx]
        s = 0.0
        for t in query_tokens:
            f = tf.get(t)
            if f:
                s += self.idf[t] * f * (k1 + 1) / (f + k1 * (1 - b + b * length / self.avg_len))
        return s

    def _allowed(self, c, scope, year):
        if c.get("status") == "disabled":
            return False
        if scope == "CURRENT" and (c.get("status") in ("superseded", "historical") or c.get("superseded_by")):
            return False
        if scope == "CURRENT" and c.get("effective_until") and c["effective_until"] < date.today().isoformat():
            return False
        return True

    @staticmethod
    def _prior(c, scope, year, topic, language):
        """Multiplier from authority, freshness, extraction quality and soft topic/language match."""
        m = {0: 1.05, 1: 1.0, 2: 0.85}.get(c.get("authority_level"), 0.75)
        if c.get("extraction_method") == "ocr":
            conf = c.get("ocr_confidence") or 0.7
            m *= 0.8 + 0.2 * min(1.0, conf / 0.9)
        if c.get("verified"):
            m *= 1.05
        pub = c.get("published_date")
        if pub and scope in ("CURRENT", "HISTORICAL"):
            age_years = (date.today() - date.fromisoformat(pub)).days / 365
            m *= max(0.8, 1 - 0.04 * age_years) if scope == "CURRENT" else 1.0
        if year and pub:
            m *= 1.25 if pub.startswith(str(year)) else 0.85
        if topic and c.get("topic") == topic:
            m *= 1.1
        if language and c.get("language") == language:
            m *= 1.03
        return m

    @staticmethod
    def _facts(text):
        t = normalise(text)
        return {"amounts": {a.replace(",", "") for a in AMOUNT.findall(t)}, "days": set(DAYS.findall(t))}

    def document_text(self, doc_id, limit=None):
        """The document's full text (all its chunks, in order); charters are ~2,000 characters."""
        lines = "\n".join(c.get("body") or c["text"] for c in self.by_doc.get(doc_id, [])).split("\n")
        # OCR leaves fragments like "| i" or "AA"; they cost answer-model tokens and carry nothing.
        text = "\n".join(l for l in lines if len(re.findall(r"[\wऀ-ॿ]", l)) >= 4)
        return text[:limit] if limit else text

    def _answer_documents(self, keep):
        """What the answer model sees: the best document whole (up to 1,900 chars) plus short supporting passages.
        When the runner-up is a close sibling from the same department (new connection vs re-connection),
        both are given in full-ish (1,100 chars each) so the model can tell the services apart."""
        if not keep:
            return []
        sibling = (len(keep) > 1 and keep[1]["final"] >= 0.9 * keep[0]["final"]
                   and keep[0].get("department") and keep[0].get("department") == keep[1].get("department"))
        docs = []
        for n, r in enumerate(keep):
            if n == 0:
                text = self.document_text(r["doc_id"], 1100 if sibling else 1900)
            elif n == 1 and sibling:
                text = self.document_text(r["doc_id"], 1100)
            else:
                text = (r.get("body") or r["text"])[:450]
            docs.append(self._as_document(r, text))
        return docs

    @staticmethod
    def _same_service(a, b):
        """Two documents describe the same service when their titles largely overlap (e.g. an old and a new
        version of one charter or circular). Water vs drainage charters are different services, never a conflict."""
        ta = set(_tokens(normalise(a.get("title") or "")))
        tb = set(_tokens(normalise(b.get("title") or "")))
        return bool(ta and tb) and len(ta & tb) / len(ta | tb) >= 0.6

    def _conflict(self, top):
        """Different amounts / time limits for the same kind of fact in different versions of the same service."""
        if not top:
            return None
        docs = [top[0]] + [d for d in top[1:4] if d["doc_id"] != top[0]["doc_id"] and self._same_service(top[0], d)]
        if len(docs) < 2:
            return None
        for kind in ("amounts", "days"):
            values = [(d, self._facts(self.document_text(d["doc_id"]))[kind]) for d in docs]
            values = [(d, v) for d, v in values if v]
            if len(values) >= 2 and not set.intersection(*[v for _, v in values]):
                return {"kind": kind, "documents": [{"title": d["title"], "published_date": d.get("published_date"),
                                                     "values": sorted(v)} for d, v in values]}
        return None

    # ---------------- search ----------------
    def search(self, query, topic=None, language=None, top_k=3):
        if not self.ready:
            return {"documents": [], "confidence": "LOW", "reason": "kb_not_loaded"}
        started = time.time()
        scope, year = time_scope(query)
        allowed = [i for i, c in enumerate(self.chunks) if self._allowed(c, scope, year)]
        if not allowed:
            return {"documents": [], "confidence": "LOW", "reason": "no_candidates", "time_scope": scope}

        q = normalise(query)
        qvec = embed([q])[0]
        sims = self.vectors[allowed] @ qvec
        vec_rank = [allowed[i] for i in np.argsort(-sims)[:CANDIDATES]]
        qtok = _tokens(q)
        bm = [(i, self._bm25(qtok, i)) for i in allowed]
        bm = [x for x in bm if x[1] > 0]
        bm.sort(key=lambda x: -x[1])
        kw_rank = [i for i, _ in bm[:CANDIDATES]]

        fused = Counter()
        for rank_list in (vec_rank, kw_rank):
            for r, i in enumerate(rank_list):
                fused[i] += 1 / (60 + r)
        candidates = [i for i, _ in fused.most_common(RERANK_TOP)]
        cosine = {allowed[j]: float(sims[j]) for j in range(len(allowed))}
        keyword_top = set(kw_rank[:10])

        if self.reranker is not None:
            # CrossEncoder already applies a sigmoid for this model: predictions are probabilities.
            probs = self.reranker.predict([(q, self.chunks[i]["text"][:1500]) for i in candidates],
                                          batch_size=len(candidates), show_progress_bar=False)
            relevance_of = {i: float(p) for i, p in zip(candidates, probs)}
        else:
            # Calibrated cosine, nudged up when keyword search independently agrees.
            relevance_of = {i: min(1.0, max(0.0, (cosine[i] - (COS_LOW - 0.1)) / (COS_HIGH - COS_LOW + 0.1))
                                   + (0.1 if i in keyword_top else 0.0)) for i in candidates}
        max_fused = max(fused[i] for i in candidates)
        results = []
        for i in candidates:
            c = self.chunks[i]
            relevance = relevance_of[i]
            blended = 0.7 * relevance + 0.3 * fused[i] / max_fused
            results.append({**c, "relevance": round(relevance, 4), "cosine": round(cosine[i], 4),
                            "final": round(blended * self._prior(c, scope, year, topic, language), 4)})
        results.sort(key=lambda r: -r["final"])

        # One chunk per document in the answer context, best first.
        seen, top = set(), []
        for r in results:
            if r["doc_id"] not in seen:
                seen.add(r["doc_id"])
                top.append(r)
        conflict = self._conflict(top)
        best = top[0] if top else None
        best_cos = max((r["cosine"] for r in top), default=0.0)
        # Short keyword-style questions ("Which prabhag is Chikhali?") embed weakly; a best result that keyword
        # search also ranks near the top is still trusted.
        keyword_backed = bool(best) and best["chunk_id"] in {self.chunks[i]["chunk_id"] for i in kw_rank[:3]}
        if (not best or (best_cos < COS_LOW and not (keyword_backed and best_cos >= COS_LOW - 0.05))
                or (self.reranker is not None and best["relevance"] < 0.2)):
            confidence = "LOW"
        elif (best_cos >= COS_HIGH and best.get("authority_level", 2) <= 1 and best.get("extraction_method") != "ocr"
              and not conflict):
            confidence = "HIGH"
        else:
            confidence = "MEDIUM"
        if conflict and confidence == "HIGH":
            confidence = "MEDIUM"

        keep = [r for r in top[:top_k] if r["final"] >= best["final"] * 0.6] if best and confidence != "LOW" else []
        return {
            # The best document goes to the answer model whole (a time limit or fee is often in a different chunk
            # than the one that matched); supporting documents contribute their matching chunk only.
            "documents": self._answer_documents(keep),
            "confidence": confidence, "time_scope": scope, "year": year, "conflict": conflict,
            "ms": int((time.time() - started) * 1000),
        }

    @staticmethod
    def _as_document(r, full_text=None):
        """Shape expected by the Express chat controller (same keys as the curated KB)."""
        return {
            "id": r["chunk_id"], "topic": r.get("topic") or "general", "title": r["title"] or r.get("section") or "PCMC",
            "content": full_text or r.get("body") or r["text"],
            "source": "PCMC (verified)" if r.get("category") == "curated" else "pcmcindia.gov.in",
            "sourceUrl": r.get("url"), "serviceUrl": r.get("service_url"), "serviceLabel": r.get("service_label"),
            "lastVerified": (r.get("fetched_at") or "")[:10], "publishedDate": r.get("published_date"),
            "category": r.get("category"), "authorityLevel": r.get("authority_level"), "extraction": r.get("extraction_method"),
            "relevance": r["relevance"], "score": round(r["final"] * 20, 3), "coverage": 1.0,
        }


hybrid = HybridRetriever()


def load_in_background():
    def run():
        try:
            hybrid.load()
        except Exception as err:  # the chatbot falls back to the curated BM25 retriever
            logger.error(f"Hybrid KB failed to load: {err}")
    threading.Thread(target=run, daemon=True).start()
