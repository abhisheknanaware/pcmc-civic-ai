"""
LangGraph pipeline that *understands* a citizen chat message:
language -> PII redaction -> intent/topic (Qwen, structured JSON) -> knowledge retrieval.
The answer itself is streamed by the Express backend with the same Qwen model.
"""
import json
import logging
import os
import re
import sys
from typing import List, Optional, TypedDict

import httpx
from langgraph.graph import StateGraph, END

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from preprocessing.language import detect_language
from preprocessing.pii_redaction import redact_pii
from chat.retriever import retriever
from chat.hybrid import hybrid

logger = logging.getLogger(__name__)

# 127.0.0.1, not "localhost": on Windows the IPv6 attempt adds ~2s per request before falling back.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
CHAT_MODEL = os.getenv("REPLY_MODEL", "qwen3.5:latest")  # same model as officer smart replies
KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
# Must match backend/services/llmService.js MODEL_OPTIONS exactly, or Ollama reloads the model between calls.
MODEL_OPTIONS = {"num_ctx": 4096, **({"num_gpu": int(os.environ["OLLAMA_NUM_GPU"])} if os.getenv("OLLAMA_NUM_GPU") else {})}

# Fast path: a clear question with no sign of a reported problem, strongly matching one knowledge-base entry,
# is answered without the ~1-2s classification call. Anything that might be a complaint still goes to Qwen.
QUESTION = re.compile(
    r"\?|\b(how|where|what|which|when|who|can i|do i|is there|kaise|kahan|kaha|kya|kab|kasa|kashi|kase|kuthe|kay|kevha)\b"
    r"|कसा|कशी|कसे|कुठे|काय|केव्हा|कैसे|कहाँ|कहां|क्या|कब", re.IGNORECASE)
PROBLEM = re.compile(
    r"\b(not|no|nahi|nahin|never|broken|damaged|overflow\w*|leak\w*|block\w*|pothole\w*|garbage|dirty|smell|stray|"
    r"complain\w*|problem|issue|since|days?|din|divas)\b|नाही|नहीं|नही|खड्डे|गड्ढे|कचरा|तुंब|बंद|गळती|समस्या|तक्रार|शिकायत|दिवसांपासून|दिन से",
    re.IGNORECASE)
FAST_PATH_MIN_SCORE = 5.0
FAST_PATH_MARGIN = 1.8  # top match must clearly beat the runner-up

INTENTS = ["SERVICE_QUESTION", "COMPLAINT", "COMPLAINT_STATUS", "GREETING", "OTHER"]
TOPICS = ["property_tax", "water", "electricity", "birth_death_certificate", "building_permission", "garbage", "roads", "street_lights",
          "drainage", "ward_info", "department_info", "complaint_help", "contact", "other_services", "general"]

TICKET = re.compile(r"\bPCMC[-\s]?(\d{6,})\b", re.IGNORECASE)
GREETING = re.compile(r"^\s*(hi+|hello|hey|namaste|namaskar|नमस्ते|नमस्कार|good (morning|afternoon|evening)|thanks?|thank you|धन्यवाद)[\s!.,?]*$", re.IGNORECASE)

UNDERSTAND_PROMPT = """You route messages sent to the Pimpri-Chinchwad Municipal Corporation (PCMC) citizen assistant.
Messages may be in English, Hindi, Marathi or Hinglish.

intent:
- SERVICE_QUESTION: asks how to do something or for information (pay tax, get a certificate, office address, which department, helpline, documents).
- COMPLAINT: reports a problem that PCMC should fix (garbage not collected, pothole, no water, drain overflowing, street light off, stray dogs...).
- COMPLAINT_STATUS: asks about the status of a complaint they already filed.
- GREETING: only a greeting or thanks.
- OTHER: anything unrelated to PCMC civic services.

topic: one of property_tax, water, electricity, birth_death_certificate, building_permission, garbage, roads, street_lights, drainage,
ward_info, department_info, complaint_help, contact, other_services, general.
Use complaint_help for questions about how to file or track complaints, general if none fits.

Examples:
"How do I pay property tax?" -> {"intent": "SERVICE_QUESTION", "topic": "property_tax"}
"Property tax kasa bharaycha?" -> {"intent": "SERVICE_QUESTION", "topic": "property_tax"}
"जन्म दाखला कुठे मिळेल?" -> {"intent": "SERVICE_QUESTION", "topic": "birth_death_certificate"}
"Mere area mein 3 din se garbage nahi uthaya" -> {"intent": "COMPLAINT", "topic": "garbage"}
"रस्त्यावर मोठे खड्डे आहेत" -> {"intent": "COMPLAINT", "topic": "roads"}
"What is the status of my complaint?" -> {"intent": "COMPLAINT_STATUS", "topic": "complaint_help"}
"Where is the zone B office?" -> {"intent": "SERVICE_QUESTION", "topic": "ward_info"}
"How do I pay my electricity bill?" -> {"intent": "SERVICE_QUESTION", "topic": "electricity"}
"Light nahi hai subah se" -> {"intent": "COMPLAINT", "topic": "electricity"}
"Street light band hai" -> {"intent": "COMPLAINT", "topic": "street_lights"}
"Who won the cricket match?" -> {"intent": "OTHER", "topic": "general"}
{history}
Message: "{message}"
Reply with JSON only, exactly like the examples."""


class ChatState(TypedDict, total=False):
    message: str
    history: List[dict]
    language: str
    redacted: str
    intent: str
    topic: str
    search_query: str
    ticket_number: Optional[str]
    documents: List[dict]
    retrieval: dict
    understood_by: str


def language_node(state: ChatState):
    return {"language": detect_language(state["message"])}


def redact_node(state: ChatState):
    return {"redacted": redact_pii(state["message"])}


def understand_node(state: ChatState):
    text = state["redacted"]
    ticket = TICKET.search(state["message"])
    if ticket:
        return {"intent": "COMPLAINT_STATUS", "topic": "complaint_help", "search_query": "complaint status",
                "ticket_number": f"PCMC-{ticket.group(1)}", "understood_by": "rule"}
    if GREETING.match(text):
        return {"intent": "GREETING", "topic": "general", "search_query": "", "ticket_number": None, "understood_by": "rule"}
    if QUESTION.search(text) and not PROBLEM.search(text):
        hits = retriever.search(text)
        clear_winner = hits and hits[0]["score"] >= FAST_PATH_MIN_SCORE and hits[0]["coverage"] >= 0.5 and (
            len(hits) == 1 or hits[0]["score"] >= FAST_PATH_MARGIN * hits[1]["score"])
        if clear_winner:
            # Intent/topic decided without the LLM; the hybrid KB (if loaded) still does the retrieval.
            return {"intent": "SERVICE_QUESTION", "topic": hits[0]["topic"], "search_query": text, "ticket_number": None,
                    "understood_by": "rule", "documents": [] if hybrid.ready else hits}

    history = state.get("history") or []
    history_text = ""
    if history:
        lines = [f'{turn["role"]}: {turn["content"][:300]}' for turn in history[-4:]]
        history_text = "\nRecent conversation (for context only):\n" + "\n".join(lines) + "\n"
    prompt = UNDERSTAND_PROMPT.replace("{history}", history_text).replace("{message}", text.replace('"', "'"))
    try:
        response = httpx.post(f"{OLLAMA_URL}/api/chat", timeout=60, json={
            "model": CHAT_MODEL,
            "stream": False,
            "think": False,
            "keep_alive": KEEP_ALIVE,
            # Plain JSON mode is ~2x faster than a strict schema here; values are validated below.
            "format": "json",
            "options": {**MODEL_OPTIONS, "temperature": 0, "num_predict": 40},
            "messages": [{"role": "user", "content": prompt}],
        })
        response.raise_for_status()
        parsed = json.loads(response.json()["message"]["content"])
        intent = parsed.get("intent") if parsed.get("intent") in INTENTS else "OTHER"
        topic = parsed.get("topic") if parsed.get("topic") in TOPICS else "general"
        return {"intent": intent, "topic": topic, "search_query": text,
                "ticket_number": None, "understood_by": "llm"}
    except Exception as error:
        logger.error(f"Chat understanding failed, falling back to retrieval only: {error}")
        return {"intent": "SERVICE_QUESTION", "topic": "general", "search_query": text, "ticket_number": None, "understood_by": "fallback"}


def retrieve_node(state: ChatState):
    topic = None if state["topic"] == "general" else state["topic"]
    if hybrid.ready:
        try:
            lang = {"English": "en", "Marathi": "mr", "Hindi": "hi"}.get(state.get("language"))
            result = hybrid.search(state["redacted"], topic=topic, language=lang)
            return {"documents": result.pop("documents"), "retrieval": {"engine": "hybrid", **result}}
        except Exception as error:
            logger.error(f"Hybrid retrieval failed, using curated KB: {error}")
    query = f'{state["search_query"]} {state["redacted"]}'
    return {"documents": retriever.search(query, topic=topic), "retrieval": {"engine": "curated_bm25"}}


def route_after_understanding(state: ChatState):
    # Complaints and questions both benefit from retrieval (e.g. complaint_help, zone info); greetings/status don't.
    # The fast path already retrieved.
    if state.get("documents"):
        return END
    return "retrieve" if state["intent"] in ("SERVICE_QUESTION", "COMPLAINT", "OTHER") else END


graph = StateGraph(ChatState)
graph.add_node("language", language_node)
graph.add_node("redact", redact_node)
graph.add_node("understand", understand_node)
graph.add_node("retrieve", retrieve_node)
graph.set_entry_point("language")
graph.add_edge("language", "redact")
graph.add_edge("redact", "understand")
graph.add_conditional_edges("understand", route_after_understanding, {"retrieve": "retrieve", END: END})
graph.add_edge("retrieve", END)
chat_app = graph.compile()


def understand_message(message: str, history: Optional[list] = None) -> dict:
    state = chat_app.invoke({"message": message, "history": history or [], "documents": []})
    return {
        "language": state.get("language"),
        "redacted": state.get("redacted"),
        "intent": state.get("intent"),
        "topic": state.get("topic"),
        "searchQuery": state.get("search_query"),
        "ticketNumber": state.get("ticket_number"),
        "understoodBy": state.get("understood_by"),
        "documents": state.get("documents", []),
        "retrieval": state.get("retrieval") or {"engine": "curated_bm25"},
    }
