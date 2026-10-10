"""Suggest a complaint category from a photo with CLIP (zero-shot: image vs. text descriptions, no training).

Only categories you can recognise in a picture are described; for the rest (property tax, education...)
the text classifier decides. Runs on the CPU (~0.5 s per photo) and loads lazily on first use.
"""
import logging
import os
import threading

import numpy as np

logger = logging.getLogger(__name__)
# Local copy (nlp/models/, downloaded once) if present, otherwise the Hugging Face hub name.
_LOCAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "clip-ViT-B-32")
MODEL_NAME = _LOCAL if os.path.exists(os.path.join(_LOCAL, "0_CLIPModel", "model.safetensors")) else "clip-ViT-B-32"
MIN_CONFIDENCE = 0.35  # below this the photo is ambiguous and no suggestion is made

# Several phrasings per category, averaged, make zero-shot CLIP noticeably more stable.
PROMPTS = {
    "Garbage & Solid Waste": ["a pile of garbage on the street", "overflowing garbage bin", "trash dumped on the roadside", "plastic waste and litter heap"],
    "Road & Potholes": ["a pothole in the road", "a damaged broken road surface", "cracked asphalt road with holes", "a road with big potholes filled with water"],
    "Street Lights & Electrical": ["a broken street light pole", "a street lamp that is not working at night", "dangling electric wires on a pole", "a damaged electrical junction box on the street"],
    "Water Supply": ["a leaking water pipe spraying water", "a burst water pipeline on the road", "a broken public water tap leaking"],
    "Drainage & Sewerage": ["an overflowing sewage drain", "an open manhole on the road", "a blocked gutter with dirty water", "sewage water overflowing on the street"],
    "Storm-Water / Rainwater": ["a flooded street after heavy rain", "rainwater logging on the road", "a waterlogged road with vehicles in water"],
    "Traffic & Transportation": ["a traffic jam on a city road", "a broken traffic signal", "vehicles parked illegally blocking the road"],
    "Encroachment": ["street vendor stalls blocking the footpath", "illegal shops encroaching on the sidewalk", "hawkers occupying the pavement"],
    "Public Health & Sanitation": ["a dirty public toilet", "stagnant water with mosquito breeding", "an unclean unhygienic public place"],
    "Stray Animals": ["stray dogs on the street", "a stray cow standing on the road", "a group of street dogs"],
    "Tree & Garden": ["a fallen tree blocking the road", "a broken tree branch hanging over the road", "an unmaintained public garden"],
    "Pollution & Environment": ["garbage being burnt with smoke", "thick smoke pollution from a chimney", "polluted river with floating waste"],
    "Building & Construction": ["an illegal construction site", "a dangerous old building with cracks", "construction debris dumped on the road"],
    "Public Infrastructure": ["a broken footpath with missing tiles", "a damaged bus stop shelter", "a broken public bench in a park"],
}

_lock = threading.Lock()
_model = None
_label_matrix = None
_labels = None


def _load():
    global _model, _label_matrix, _labels
    with _lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(MODEL_NAME, device="cpu")
            labels, vectors = [], []
            for category, prompts in PROMPTS.items():
                emb = _model.encode([f"a photo of {p}" for p in prompts], normalize_embeddings=True)
                mean = emb.mean(axis=0)
                vectors.append(mean / np.linalg.norm(mean))
                labels.append(category)
            _labels, _label_matrix = labels, np.vstack(vectors)
    return _model


def classify_image(path):
    """Return {category, confidence, alternatives} or {category: None} when the photo is ambiguous."""
    from PIL import Image

    model = _load()
    with Image.open(path) as img:
        vec = model.encode([img.convert("RGB")], normalize_embeddings=True)[0]
    logits = 100.0 * (_label_matrix @ vec)          # CLIP's usual temperature
    probs = np.exp(logits - logits.max())
    probs /= probs.sum()
    order = np.argsort(-probs)
    best = int(order[0])
    result = {
        "category": _labels[best] if probs[best] >= MIN_CONFIDENCE else None,
        "confidence": round(float(probs[best]), 3),
        "alternatives": [{"category": _labels[int(i)], "confidence": round(float(probs[int(i)]), 3)} for i in order[:3]],
    }
    return result
