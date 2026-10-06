import os
import re
import shutil
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any, TypedDict, List
import uvicorn
from langdetect import detect, detect_langs
from pydantic import BaseModel
import difflib

from preprocessing.pii_redaction import redact_pii
from preprocessing.language import detect_language
from speech.whisper_model import transcribe_audio
from classification.classifier import classify_complaint
from ner.entity_extractor import extract_entities
from sentiment.sentiment import analyze_sentiment
from urgency.urgency import detect_urgency
from routing.routing import determine_priority_and_department
from routing.ward_mapping import determine_ward

from langgraph.graph import StateGraph, END

load_dotenv()
logger = logging.getLogger(__name__)

# Define Agent State
class AgentState(TypedDict):
    original_text: str
    sanitized_text: str
    language: str
    category: str
    subcategory: str
    categoryConfidence: float
    subcategoryConfidence: float
    entities: dict
    sentiment: str
    urgency: str
    priority: str
    department: str
    ward: str
    wardNumber: Optional[int]
    zone: Optional[str]

# Define Node Functions
def redact_node(state: AgentState):
    sanitized = redact_pii(state["original_text"])
    return {"sanitized_text": sanitized}

def language_node(state: AgentState):
    return {"language": detect_language(state["sanitized_text"])}

def classify_node(state: AgentState):
    classification = classify_complaint(state["sanitized_text"])
    return {
        "category": classification.get("category"),
        "subcategory": classification.get("subcategory"),
        "categoryConfidence": classification.get("categoryConfidence"),
        "subcategoryConfidence": classification.get("subcategoryConfidence")
    }

def ner_node(state: AgentState):
    entities = extract_entities(state["sanitized_text"])
    return {"entities": entities}

def sentiment_node(state: AgentState):
    sentiment = analyze_sentiment(state["sanitized_text"])
    return {"sentiment": sentiment}

def urgency_node(state: AgentState):
    urgency = detect_urgency(state["sanitized_text"], state.get("sentiment", "Neutral"))
    return {"urgency": urgency}

def routing_node(state: AgentState):
    priority, department = determine_priority_and_department(state.get("category", "Other / General"), state.get("urgency", "Medium"))
    location = determine_ward(state["sanitized_text"])
    return {"priority": priority, "department": department, **location}

# Build LangGraph Workflow
workflow = StateGraph(AgentState)

workflow.add_node("redact", redact_node)
workflow.add_node("language", language_node)
workflow.add_node("classify", classify_node)
workflow.add_node("ner", ner_node)
workflow.add_node("sentiment", sentiment_node)
workflow.add_node("urgency", urgency_node)
workflow.add_node("routing", routing_node)

workflow.set_entry_point("redact")
workflow.add_edge("redact", "language")
workflow.add_edge("language", "classify")
workflow.add_edge("classify", "ner")
workflow.add_edge("ner", "sentiment")
workflow.add_edge("sentiment", "urgency")
workflow.add_edge("urgency", "routing")
workflow.add_edge("routing", END)

nlp_app = workflow.compile()

app = FastAPI(title="Complaint AI NLP Service (LangGraph)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/process")
async def process_complaint(
    text: Optional[str] = Form(None),
    audio: Optional[UploadFile] = File(None)
):
    final_text = text or ""
    
    # 1. Process Audio if present
    if audio:
        temp_audio_path = f"temp_{audio.filename}"
        with open(temp_audio_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        
        transcribed_text = transcribe_audio(temp_audio_path)
        final_text = transcribed_text + " " + final_text
        
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)

    final_text = final_text.strip()
    if not final_text:
        return {"error": "No text or audio provided"}

    # Invoke LangGraph Pipeline
    initial_state = AgentState(original_text=final_text)
    final_state = nlp_app.invoke(initial_state)
    
    return {
        "sanitizedText": final_state.get("sanitized_text"),
        "language": final_state.get("language"),
        "category": final_state.get("category"),
        "subcategory": final_state.get("subcategory"),
        "categoryConfidence": final_state.get("categoryConfidence"),
        "subcategoryConfidence": final_state.get("subcategoryConfidence"),
        "sentiment": final_state.get("sentiment"),
        "urgency": final_state.get("urgency"),
        "priority": final_state.get("priority"),
        "department": final_state.get("department"),
        "ward": final_state.get("ward"),
        "wardNumber": final_state.get("wardNumber"),
        "zone": final_state.get("zone"),
        "entities": final_state.get("entities")
    }

class ChatRequest(BaseModel):
    message: str
    history: List[Dict] = []

@app.on_event("startup")
def load_knowledge_base():
    # Embedding + re-ranker models load in a background thread; chat uses the curated KB until ready.
    from chat.hybrid import load_in_background
    load_in_background()

@app.post("/kb/reload")
def kb_reload():
    from chat.hybrid import hybrid
    return {"loaded": hybrid.reload(), "chunks": len(hybrid.chunks)}

@app.get("/kb/status")
def kb_status():
    from chat.hybrid import hybrid
    return {"ready": hybrid.ready, "chunks": len(hybrid.chunks)}

@app.post("/chat/understand")
async def chat_understand(req: ChatRequest):
    # Imported lazily so complaint processing never depends on the chat module.
    from chat.chat_graph import understand_message
    return understand_message(req.message[:1000], req.history[-6:])

class DuplicateRequest(BaseModel):
    new_text: str
    existing_complaints: List[Dict]

@app.post("/check-duplicates")
async def check_duplicates(req: DuplicateRequest):
    if not req.existing_complaints:
        return {"duplicates": []}
    
    try:
        duplicates = []
        for c in req.existing_complaints:
            # Simple sequence matcher for similarity
            score = difflib.SequenceMatcher(None, req.new_text, c['text']).ratio()
            if score > 0.45:
                duplicates.append({
                    "id": c['id'],
                    "score": float(score)
                })
        return {"duplicates": duplicates}
    except Exception as e:
        print(f"Error in duplicate detection: {e}")
        return {"duplicates": []}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
