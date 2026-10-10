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

# ---- Weekly knowledge-base refresh ----
# Every KB_REFRESH_DAYS (default 7, 0 turns it off) the crawl -> extract -> chunk -> index pipeline runs
# in the background during the night window starting at KB_REFRESH_HOUR, then the chatbot reloads.
import threading
import time as _time
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

REFRESH_DAYS = int(os.getenv("KB_REFRESH_DAYS", "7"))
REFRESH_HOUR = int(os.getenv("KB_REFRESH_HOUR", "2"))
_refresh = {"running": False, "step": None, "lock": threading.Lock()}

def _run_refresh(trigger):
    from ingest.refresh import run
    from chat.hybrid import hybrid
    try:
        report = run(trigger=trigger, on_progress=lambda s: _refresh.update(step=s))
        if report["ok"]:
            hybrid.reload()
    except Exception as error:
        logging.getLogger(__name__).error(f"Knowledge-base refresh failed: {error}")
    finally:
        _refresh.update(running=False, step=None)

def _start_refresh(trigger):
    with _refresh["lock"]:
        if _refresh["running"]:
            return False
        _refresh.update(running=True, step="starting")
    threading.Thread(target=_run_refresh, args=(trigger,), daemon=True, name="kb-refresh").start()
    return True

def _next_refresh(report):
    if REFRESH_DAYS <= 0:
        return None
    from ingest.extract import DOCS_PATH
    if report and report.get("finishedAt"):
        last = _dt.fromisoformat(report["finishedAt"])
    elif DOCS_PATH.exists():  # first run: count from the manual crawl that built the current index
        last = _dt.fromtimestamp(DOCS_PATH.stat().st_mtime, _tz.utc)
    else:
        last = None
    now = _dt.now(_tz.utc)
    earliest = max(last + _td(days=REFRESH_DAYS), now) if last else now
    local = earliest.astimezone()
    if not REFRESH_HOUR <= local.hour < REFRESH_HOUR + 3:
        local = local.replace(hour=REFRESH_HOUR, minute=0, second=0, microsecond=0)
        if local < earliest:
            local += _td(days=1)
    return local

def _refresh_scheduler():
    from ingest.refresh import load_report
    while True:
        _time.sleep(1800)
        try:
            nxt = _next_refresh(load_report())
            if nxt and _dt.now().astimezone() >= nxt:
                _start_refresh("schedule")
        except Exception as error:
            logging.getLogger(__name__).error(f"Refresh scheduler: {error}")

@app.on_event("startup")
def start_refresh_scheduler():
    if REFRESH_DAYS > 0:
        threading.Thread(target=_refresh_scheduler, daemon=True, name="kb-refresh-scheduler").start()

@app.get("/kb/refresh")
def kb_refresh_status(request: Request):
    local_only(request)
    from ingest.refresh import load_report
    report = load_report() or {}
    report.pop("current", None)
    nxt = _next_refresh(report)
    return {**report, "running": _refresh["running"], "step": _refresh["step"],
            "nextRun": nxt.isoformat(timespec="minutes") if nxt else None, "everyDays": REFRESH_DAYS}

@app.post("/kb/refresh", status_code=202)
def kb_refresh_start(request: Request):
    local_only(request)
    if not _start_refresh("manual"):
        raise HTTPException(status_code=409, detail="A refresh is already running")
    return {"started": True}

class RefreshReviewed(BaseModel):
    reviewer: Optional[str] = None

@app.post("/kb/refresh/reviewed")
def kb_refresh_reviewed(body: RefreshReviewed, request: Request):
    local_only(request)
    from ingest.refresh import load_report, save_report
    report = load_report()
    if not report or not report.get("finishedAt"):
        raise HTTPException(status_code=404, detail="No finished refresh to review")
    report.update(reviewed=True, reviewedBy=body.reviewer, reviewedAt=_dt.now(_tz.utc).isoformat(timespec="seconds"))
    save_report(report)
    return {"reviewed": True}

# Knowledge-base admin: only the Express backend on this machine (which enforces officer login) may call these.
# In Docker the backend runs in another container, so it proves itself with a shared INTERNAL_API_TOKEN instead.
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")

def local_only(request: Request):
    import hmac
    token = request.headers.get("x-internal-token", "")
    if INTERNAL_API_TOKEN and hmac.compare_digest(token, INTERNAL_API_TOKEN):
        return
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
    lat: Optional[float] = None
    lng: Optional[float] = None

# Candidates are already the same category (the backend filters). Same issue = similar meaning (bge-m3,
# works across English/Hindi/Marathi) and, when both
# complaints have a map pin, close together. Text alone must be very similar; nearby complaints need less.
DUP_TEXT_ONLY = 0.65  # calibrated on same-category pairs: same issue 0.59-0.89, different place 0.56-0.60
DUP_NEARBY = 0.45     # within 300 m the map pin does most of the work
NEARBY_METERS = 300

def _distance_m(lat1, lng1, lat2, lng2):
    import math
    rad = math.radians
    a = math.sin(rad(lat2 - lat1) / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(rad(lng2 - lng1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))

@app.post("/check-duplicates")
async def check_duplicates(req: DuplicateRequest):
    candidates = [c for c in req.existing_complaints if c.get("text")]
    if not candidates or not req.new_text.strip():
        return {"duplicates": []}
    try:
        from chat.embeddings import embed
        vectors = embed([req.new_text[:2000]] + [c["text"][:2000] for c in candidates])
        sims = vectors[1:] @ vectors[0]
        duplicates = []
        for c, sim in zip(candidates, sims):
            distance = None
            if req.lat is not None and req.lng is not None and c.get("lat") is not None and c.get("lng") is not None:
                distance = _distance_m(req.lat, req.lng, c["lat"], c["lng"])
            near = distance is not None and distance <= NEARBY_METERS
            if sim >= DUP_TEXT_ONLY or (near and sim >= DUP_NEARBY):
                duplicates.append({"id": c["id"], "score": round(float(sim), 3),
                                   "distanceM": None if distance is None else round(distance)})
        duplicates.sort(key=lambda d: -d["score"])
        return {"duplicates": duplicates[:5]}
    except Exception as e:
        # Embeddings unavailable (Ollama down): fall back to plain text similarity.
        print(f"Semantic duplicate detection failed, using text similarity: {e}")
        duplicates = []
        for c in candidates:
            score = difflib.SequenceMatcher(None, req.new_text, c["text"]).ratio()
            if score > 0.6:
                duplicates.append({"id": c["id"], "score": float(score), "distanceM": None})
        return {"duplicates": duplicates}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
