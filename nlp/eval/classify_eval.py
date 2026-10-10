"""Category accuracy on the labelled set (eval/classification_set.json): zero-shot vs Qwen vs combined.

Usage (from the nlp folder):  python eval/classify_eval.py [--only zero-shot|llm|combined]
"""
import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from classification.classifier import classify_complaint, zero_shot_category  # noqa: E402
from classification.llm_classifier import classify_with_llm  # noqa: E402

DATA = json.load(open(os.path.join(os.path.dirname(__file__), "classification_set.json"), encoding="utf-8"))


def run(name, fn):
    correct, per_lang, errors, started = 0, defaultdict(lambda: [0, 0]), Counter(), time.time()
    for item in DATA:
        predicted = fn(item["text"])
        ok = predicted == item["category"]
        correct += ok
        per_lang[item["lang"]][0] += ok
        per_lang[item["lang"]][1] += 1
        if not ok:
            errors[(item["category"], predicted)] += 1
    secs = (time.time() - started) / len(DATA)
    print(f"\n== {name}: {correct}/{len(DATA)} correct ({100 * correct / len(DATA):.0f}%), {secs:.2f} s per complaint")
    print("   by language: " + ", ".join(f"{lang} {c}/{n}" for lang, (c, n) in sorted(per_lang.items())))
    for (want, got), n in errors.most_common(8):
        print(f"   {n}x  {want}  ->  {got}")
    return correct


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["zero-shot", "llm", "combined"])
    args = ap.parse_args()
    if args.only in (None, "zero-shot"):
        run("Zero-shot XLM-R (before)", lambda t: zero_shot_category(t)[0])
    if args.only in (None, "llm"):
        run("Qwen with category descriptions", lambda t: classify_with_llm(t) or "None")
    if args.only in (None, "combined"):
        run("Combined (what the pipeline uses)", lambda t: classify_complaint(t)["category"])


if __name__ == "__main__":
    main()
