from transformers import pipeline
import logging
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_categories import PCMC_CATEGORIES
from classification.llm_classifier import classify_with_llm

logger = logging.getLogger(__name__)

# Initialize zero-shot classifier lazily
_classifier = None

CANDIDATE_LABELS = list(PCMC_CATEGORIES.keys())


def _zero_shot():
    global _classifier
    if _classifier is None:
        logger.info("Loading multilingual zero-shot classifier model...")
        try:
            _classifier = pipeline("zero-shot-classification", model="joeddav/xlm-roberta-large-xnli")
        except Exception as e:
            logger.error(f"Error loading model, falling back to keywords: {e}")
            _classifier = "fallback"
    return _classifier


def _keyword_fallback(text: str):
    text_lower = text.lower()
    if "garbage" in text_lower or "kachra" in text_lower:
        return "Garbage & Solid Waste", 0.5
    if "water" in text_lower or "pani" in text_lower:
        return "Water Supply", 0.5
    if "road" in text_lower or "pothole" in text_lower or "khadda" in text_lower:
        return "Road & Potholes", 0.5
    return "Other / General", 0.1


def zero_shot_category(text: str):
    """(category, confidence) from the zero-shot XLM-R model over bare category names."""
    clf = _zero_shot()
    if clf == "fallback":
        return _keyword_fallback(text)
    result = clf(text, CANDIDATE_LABELS)
    return result['labels'][0], float(result['scores'][0])


def classify_complaint(text: str) -> dict:
    """
    Classifies a complaint into a PCMC category and subcategory.
    Qwen (with category descriptions) decides; the zero-shot model is the fallback and a second opinion:
    when both agree the confidence is high, when they disagree Qwen's choice is used at moderate confidence.
    """
    try:
        zs_category, zs_confidence = zero_shot_category(text)
    except Exception as e:
        logger.error(f"Zero-shot classification failed: {e}")
        zs_category, zs_confidence = "Other / General", 0.0

    llm_category = classify_with_llm(text)
    if llm_category and llm_category == zs_category:
        category, confidence, source = llm_category, max(zs_confidence, 0.9), "llm+zero-shot"
    elif llm_category:
        category, confidence, source = llm_category, 0.75, "llm"
    else:
        category, confidence, source = zs_category, zs_confidence, "zero-shot"

    subcategory, subcategory_confidence = "Other issue", 0.0
    try:
        subcategories = PCMC_CATEGORIES.get(category, ["Other issue"])
        clf = _zero_shot()
        if len(subcategories) > 1 and clf != "fallback":
            sub_result = clf(text, subcategories)
            subcategory, subcategory_confidence = sub_result['labels'][0], float(sub_result['scores'][0])
        else:
            subcategory, subcategory_confidence = subcategories[0], 1.0
    except Exception as e:
        logger.error(f"Subcategory classification failed: {e}")

    return {
        "category": category,
        "subcategory": subcategory,
        "categoryConfidence": float(confidence),
        "subcategoryConfidence": float(subcategory_confidence),
        "categorySource": source,
    }
