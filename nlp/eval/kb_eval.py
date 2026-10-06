"""Retrieval evaluation for the hybrid KB: does the right official source come back, with sensible confidence?

Each case lists URL fragments of acceptable sources. Out-of-scope cases expect confidence LOW.
Usage:  python eval/kb_eval.py        (from the nlp folder; loads the models, ~30 s)
"""
import os
import statistics
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from chat.hybrid import hybrid, time_scope  # noqa: E402

CASES = [
    # (question, acceptable source URL fragments, expected confidence set)
    ("How do I get a new water connection?", ["2_water", "water-bill", "kb-water"], None),
    ("नळ कनेक्शन मंजुरीसाठी कोणती कागदपत्रे लागतात?", ["2_water"], None),
    ("naya nal connection ke liye kya documents chahiye", ["2_water"], None),
    ("How many days does PCMC take to approve a water connection?", ["2_water"], None),
    ("How to transfer property in my name after my father's death?", ["1_p_Tax"], None),
    ("मिळकत कर थकबाकी नसल्याचा दाखला कसा मिळेल?", ["1_p_Tax"], None),
    ("How do I pay property tax online?", ["kb-property-tax", "1_p_Tax"], None),
    ("drainage connection completion certificate", ["3_sewarage"], None),
    ("fire NOC renewal for a cyber cafe", ["18_fire"], None),
    ("Tree cutting permission in PCMC", ["7_garden"], None),
    ("How do I report an illegal hoarding?", ["hording", "11_skysign"], None),
    ("Where can I get a birth certificate for a child born in a private hospital?", ["bnd_info", "kb-birth"], None),
    ("citizen facilitation centre in Moshi", ["cfc_info"], None),
    ("Which prabhag is Chikhali?", ["/ward", "ward_info", "kb-zone"], None),
    ("PCMC head office address and email", ["contact", "kb-contact"], None),
    ("What is the Right to Public Services Act?", ["rts_e"], None),
    ("marriage registration in PCMC", ["cfc_info", "20_Marriage"], None),
    ("Who is the PCMC commissioner?", ["departments-details", "kb-departments"], None),
    ("Zone B office phone number", ["kb-zone-B", "ward_info"], None),
    ("water supply rates 2026-27", ["policies", "pdf/", "2_water"], None),
    # out of scope / not PCMC -> should not be answered confidently
    ("Who won the cricket match yesterday?", [], {"LOW"}),
    ("How do I apply for a passport?", [], {"LOW", "MEDIUM"}),
    ("What is the income tax slab for 2026?", [], {"LOW", "MEDIUM"}),
]

TEMPORAL = [
    ("What is the current property tax procedure?", "CURRENT"),
    ("What was the property tax rule in 2023?", "YEAR"),
    ("According to circular no. 332/2026 what is the order?", "SPECIFIC_DOCUMENT"),
    ("पूर्वी पाणीपट्टी किती होती?", "HISTORICAL"),
]


def main():
    started = time.time()
    if not hybrid.load():
        print("KB not indexed")
        return
    print(f"loaded {len(hybrid.chunks)} chunks in {time.time() - started:.1f}s\n")
    hybrid.search("warm up")

    hit1 = hit3 = answered = conf_ok = 0
    in_scope = [c for c in CASES if c[1]]
    latencies = []
    for question, wanted, expected_conf in CASES:
        r = hybrid.search(question)
        latencies.append(r["ms"])
        urls = [(d.get("sourceUrl") or "") + " " + d["id"] for d in r["documents"]]
        ok1 = bool(wanted) and bool(urls) and any(w in urls[0] for w in wanted)
        ok3 = bool(wanted) and any(any(w in u for w in wanted) for u in urls[:3])
        hit1 += ok1
        hit3 += ok3
        if wanted and r["confidence"] != "LOW":
            answered += 1
        if expected_conf:
            conf_ok += r["confidence"] in expected_conf
        mark = "OK " if (ok3 if wanted else r["confidence"] in expected_conf) else "XX "
        top = r["documents"][0] if r["documents"] else {}
        print(f"{mark}{r['confidence']:<6} {r['ms']:>5}ms  {question[:60]:<60} -> {top.get('title', '-')[:45]} "
              f"[{(top.get('sourceUrl') or '')[-40:]}] rel={top.get('relevance', 0)}")

    oos = [c for c in CASES if not c[1]]
    print(f"\nIn-scope: hit@1 {hit1}/{len(in_scope)}, hit@3 {hit3}/{len(in_scope)}, answered (not LOW) {answered}/{len(in_scope)}")
    print(f"Out-of-scope handled: {conf_ok}/{len(oos)}")
    print(f"Latency: median {statistics.median(latencies):.0f} ms, max {max(latencies)} ms")
    t_ok = sum(time_scope(q)[0] == want for q, want in TEMPORAL)
    print(f"Time-scope detection: {t_ok}/{len(TEMPORAL)}")
    for q, want in TEMPORAL:
        got = time_scope(q)
        if got[0] != want:
            print(f"   time scope wrong: {q} -> {got}, expected {want}")


if __name__ == "__main__":
    main()
