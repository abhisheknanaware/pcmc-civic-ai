from transformers import pipeline
import logging
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_categories import PCMC_CATEGORIES

logger = logging.getLogger(__name__)

# Initialize zero-shot classifier lazily
_classifier = None

CANDIDATE_LABELS = list(PCMC_CATEGORIES.keys())

def classify_complaint(text: str) -> dict:
    """
    Classifies a complaint into a PCMC category and subcategory.
    Returns: dict with category, subcategory, and confidences.
    """
    global _classifier
    if _classifier is None:
        logger.info("Loading multilingual zero-shot classifier model...")
        # Using a widely supported multilingual zero-shot model
        try:
            _classifier = pipeline("zero-shot-classification", model="joeddav/xlm-roberta-large-xnli")
        except Exception as e:
            logger.error(f"Error loading model, falling back to dummy: {e}")
            _classifier = "fallback"

    if _classifier == "fallback":
        # Fallback keyword logic if model fails to load
        text_lower = text.lower()
        if "garbage" in text_lower or "kachra" in text_lower:
            return {"category": "Garbage & Solid Waste", "subcategory": "Garbage not collected", "categoryConfidence": 0.5, "subcategoryConfidence": 0.5}
        elif "water" in text_lower or "pani" in text_lower:
            return {"category": "Water Supply", "subcategory": "No water supply", "categoryConfidence": 0.5, "subcategoryConfidence": 0.5}
        elif "road" in text_lower or "pothole" in text_lower or "khadda" in text_lower:
            return {"category": "Road & Potholes", "subcategory": "Potholes", "categoryConfidence": 0.5, "subcategoryConfidence": 0.5}
        else:
            return {"category": "Other / General", "subcategory": "General civic complaint", "categoryConfidence": 0.1, "subcategoryConfidence": 0.1}

    try:
        # Step 1: Predict Primary Category
        result = _classifier(text, CANDIDATE_LABELS)
        primary_category = result['labels'][0]
        primary_confidence = result['scores'][0]
        
        # Step 2: Predict Subcategory
        subcategories = PCMC_CATEGORIES.get(primary_category, ["Other issue"])
        if len(subcategories) > 1:
            sub_result = _classifier(text, subcategories)
            subcategory = sub_result['labels'][0]
            subcategory_confidence = sub_result['scores'][0]
        else:
            subcategory = subcategories[0]
            subcategory_confidence = 1.0

        return {
            "category": primary_category,
            "subcategory": subcategory,
            "categoryConfidence": float(primary_confidence),
            "subcategoryConfidence": float(subcategory_confidence)
        }
    except Exception as e:
        logger.error(f"Classification failed: {e}")
        return {"category": "Other / General", "subcategory": "General civic complaint", "categoryConfidence": 0.0, "subcategoryConfidence": 0.0}
