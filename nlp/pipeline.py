import os
import re
import shutil
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
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
def kb_reload(request: Request):
    local_only(request)
    from chat.hybrid import hybrid
    return {"loaded": hybrid.reload(), "chunks": len(hybrid.chunks)}

@app.get("/kb/status")
def kb_status():
    from chat.hybrid import hybrid
    return {"ready": hybrid.ready, "chunks": len(hybrid.chunks)}

# Knowledge-base admin: only the Express backend on this machine (which enforces officer login) may call these.
def local_only(request: Request):
    if request.client is None or request.client.host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Knowledge-base admin is only available through the officer backend")

@app.get("/kb/documents")
def kb_documents(request: Request):
    local_only(request)
    from chat.hybrid import hybrid
    if not hybrid.ready:
        raise HTTPException(status_code=503, detail="Knowledge base is still loading")
    return {"documents": hybrid.documents()}

class DocumentReview(BaseModel):
    status: Optional[str] = None
    verified: Optional[bool] = None
    reviewer: Optional[str] = None

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), language: Optional[str] = Form(None)):
    """Speech to text for the chatbot's mic button. Audio is written to a temp file and deleted right away."""
    import tempfile
    data = await audio.read()
    if not data or len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio is empty or larger than 10 MB")
    lang = language if language in ("en", "hi", "mr") else None
    fd, path = tempfile.mkstemp(suffix=".audio")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        text = transcribe_audio(path, lang)
    except Exception as error:
        logging.getLogger(__name__).error(f"Transcription failed: {error}")
        raise HTTPException(status_code=422, detail="Could not understand the audio")
    finally:
        if os.path.exists(path):
            os.remove(path)
    return {"text": text}

@app.post("/classify-image")
async def classify_image_endpoint(image: UploadFile = File(...)):
    """Suggest a complaint category from a photo (CLIP zero-shot). The temp file is deleted right away."""
    import tempfile
    from classification.image_classifier import classify_image
    data = await image.read()
    if not data or len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image is empty or larger than 8 MB")
    fd, path = tempfile.mkstemp(suffix=".img")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        return classify_image(path)
    except Exception as error:
        logging.getLogger(__name__).error(f"Image classification failed: {error}")
        raise HTTPException(status_code=422, detail="Could not read the image")
    finally:
        if os.path.exists(path):
            os.remove(path)

class OfficerAnswer(BaseModel):
    id: Optional[str] = None
    title: str
    answer: str
    questions: List[str] = []
    department: Optional[str] = None
    topic: Optional[str] = None
    sourceUrl: Optional[str] = None
    serviceUrl: Optional[str] = None
    serviceLabel: Optional[str] = None
    author: Optional[str] = None

@app.get("/kb/answers")
def kb_answers(request: Request):
    local_only(request)
    from chat.hybrid import hybrid
    return {"answers": hybrid.answers()}

@app.post("/kb/answers")
def kb_save_answer(payload: OfficerAnswer, request: Request):
    local_only(request)
    import uuid
    from datetime import datetime
    from chat.hybrid import hybrid
    title, answer = payload.title.strip()[:200], payload.answer.strip()[:3000]
    if len(title) < 3 or len(answer) < 10:
        raise HTTPException(status_code=400, detail="A title and an answer of at least 10 characters are required")
    for url in (payload.sourceUrl, payload.serviceUrl):
        if url and not re.match(r"^https?://", url):
            raise HTTPException(status_code=400, detail="Links must start with http:// or https://")
    now = datetime.now().isoformat(timespec="seconds")
    existing = next((a for a in hybrid.answers() if a["id"] == payload.id), None) if payload.id else None
    record = {
        "id": payload.id if existing else uuid.uuid4().hex[:12], "title": title, "answer": answer,
        "questions": [q.strip()[:200] for q in payload.questions if q.strip()][:10],
        "department": payload.department, "topic": payload.topic, "sourceUrl": payload.sourceUrl,
        "serviceUrl": payload.serviceUrl, "serviceLabel": payload.serviceLabel,
        "author": payload.author, "createdAt": existing["createdAt"] if existing else now, "updatedAt": now,
    }
    return hybrid.save_answer(record)

@app.delete("/kb/answers/{answer_id}")
def kb_delete_answer(answer_id: str, request: Request):
    local_only(request)
    from chat.hybrid import hybrid
    try:
        hybrid.delete_answer(answer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Answer not found")
    return {"deleted": answer_id}

@app.post("/kb/documents/{doc_id}")
def kb_review_document(doc_id: str, review: DocumentReview, request: Request):
    local_only(request)
    from chat.hybrid import hybrid
    try:
        return hybrid.set_document_review(doc_id, review.status, review.verified, review.reviewer)
    except KeyError:
        raise HTTPException(status_code=404, detail="Document not found")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

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
