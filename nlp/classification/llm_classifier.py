"""Complaint category from Qwen (local, via Ollama), with descriptions of what each PCMC category covers.

The zero-shot XLM-R model only sees bare category names, so "garbage not collected near the PCMC building"
can drift to "Public Infrastructure". Qwen reads short descriptions plus multilingual examples and returns
one category name as JSON. Callers fall back to the zero-shot model if Qwen is unavailable.
"""
import json
import logging
import os
import sys

import httpx

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_categories import PCMC_CATEGORIES

logger = logging.getLogger(__name__)
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("REPLY_MODEL", "qwen3:8b")
# Must match chat_graph.MODEL_OPTIONS / llmService.js, or Ollama reloads the model between calls.
MODEL_OPTIONS = {"num_ctx": 4096, **({"num_gpu": int(os.environ["OLLAMA_NUM_GPU"])} if os.getenv("OLLAMA_NUM_GPU") else {})}

DESCRIPTIONS = {
    "Garbage & Solid Waste": "garbage not collected, overflowing bins, ghanta gadi not coming, waste dumped on roads or plots",
    "Road & Potholes": "potholes, broken or damaged road surface, unfinished road digging, damaged footpath surface",
    "Street Lights & Electrical": "street light not working or on during day, dark lane, light pole or junction box faults",
    "Water Supply": "no water, low pressure, dirty tap water, irregular timing, burst or leaking water pipeline",
    "Drainage & Sewerage": "blocked drain or gutter, sewage overflow, open or broken manhole, sewer leakage, sewage smell",
    "Storm-Water / Rainwater": "rainwater logging or flooded road after rain, blocked storm-water / rain drains",
    "Traffic & Transportation": "traffic signal not working, traffic jams, illegal parking blocking roads, signage",
    "Encroachment": "hawkers or vendors on footpath, shops or sheds extended onto public road or space",
    "Public Health & Sanitation": "dirty public toilets, mosquito breeding, stagnant water, fogging, unhygienic public places",
    "Stray Animals": "stray dogs, dog bites, stray cattle on road, dead or injured animals",
    "Tree & Garden": "fallen or dangerous trees and branches, tree cutting, park or garden maintenance",
    "Pollution & Environment": "smoke, burning waste, factory pollution, noise / loudspeakers, river or water-body pollution",
    "Property Tax": "property tax bill wrong, payment not reflected, assessment or tax receipt problems",
    "Building & Construction": "illegal / unauthorised construction, unsafe or cracked buildings, construction debris, permissions",
    "Public Infrastructure": "damaged public facilities: bus shelters, benches, public signboards, public buildings",
    "Safety": "immediate danger to people: live or hanging electric wires, collapsing walls, crime-prone unsafe spots",
    "Education": "PCMC / municipal schools: teachers, students, school facilities, mid-day meals",
    "Citizen Services": "certificates (birth, death, marriage), applications, CFC / office service delays or misconduct",
    "Other / General": "suggestions, appreciation, general questions, anything that is not a specific civic problem",
}
CATEGORIES = list(PCMC_CATEGORIES.keys())

PROMPT = """You classify citizen complaints for the Pimpri-Chinchwad Municipal Corporation (PCMC).
Complaints may be in English, Hindi, Marathi or Hinglish. Choose the ONE category that best describes the problem
the citizen wants fixed (not the place where it happens).

Categories:
{categories}

Examples:
"Kachra wali gaadi teen din se nahi aayi" -> {{"category": "Garbage & Solid Waste"}}
"मंडईजवळ कचरा जाळला जातो आणि धूर येतो" -> {{"category": "Pollution & Environment"}}
"Highway service road is full of craters" -> {{"category": "Road & Potholes"}}
"सब-वे में बारिश का पानी भर गया है" -> {{"category": "Storm-Water / Rainwater"}}
"A transformer cable is sparking next to the school gate" -> {{"category": "Safety"}}

Complaint: "{text}"
Reply with JSON only: {{"category": "<exact category name from the list>"}}"""


def classify_with_llm(text: str, timeout: float = 30.0):
    """Return a category name, or None if Qwen is unavailable or answers outside the list."""
    listing = "\n".join(f"- {name}: {DESCRIPTIONS.get(name, '')}" for name in CATEGORIES)
    prompt = PROMPT.format(categories=listing, text=text.replace('"', "'")[:1500])
    try:
        response = httpx.post(f"{OLLAMA_URL}/api/chat", timeout=timeout, json={
            "model": MODEL, "stream": False, "think": False, "format": "json", "keep_alive": "30m",
            "options": {**MODEL_OPTIONS, "temperature": 0, "num_predict": 30},
            "messages": [{"role": "user", "content": prompt}],
        })
        response.raise_for_status()
        category = json.loads(response.json()["message"]["content"]).get("category", "")
    except Exception as error:
        logger.warning(f"LLM classification unavailable: {error}")
        return None
    if category in CATEGORIES:
        return category
    # Tolerate small formatting differences ("Road and Potholes", lower case).
    norm = lambda s: s.lower().replace("&", "and").replace(" ", "")
    return next((c for c in CATEGORIES if norm(c) == norm(category)), None)
