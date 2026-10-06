# PCMC Civic — AI complaint system and citizen assistant

A civic grievance platform for Pimpri-Chinchwad Municipal Corporation (PCMC). Citizens report problems by text or voice in English, Hindi, Marathi or Hinglish. An NLP pipeline classifies, prioritises and routes each complaint to the right department and zone. A chatbot answers questions about PCMC services from official PCMC sources.

## Features
- **Complaint intake:** text or voice (Whisper), PII redaction (Presidio), language detection, category/urgency/sentiment, department and zone routing, duplicate detection, ticket numbers and SLA deadlines.
- **Officer dashboard:** a ticket queue scoped to the officer's department, a map, analytics, and AI-drafted replies in the citizen's language (local Qwen through Ollama).
- **Citizen assistant:** a LangGraph pipeline (language, PII redaction, intent/topic, retrieval) with answers streamed from Qwen.
  - **Grounding:** answers come only from a knowledge base built from public PCMC pages and PDFs.
  - **Retrieval:** hybrid search (bge-m3 vectors + BM25) with time-aware filtering.
  - **Trust signals:** a confidence level on every answer, conflict detection, and citations with dates.
  - **Out-of-scope questions** get an honest "could not verify" hand-off.
- **Multilingual UI:** English, Hindi and Marathi.

## Architecture
```
frontend (React 19 + Vite)  ->  backend (Node/Express 5 + MongoDB)  ->  nlp service (FastAPI + LangGraph)
                                          |                                   |
                                          +------------ Ollama (qwen3:8b, bge-m3) -------+
```
- `config/pcmc.json`: one shared source for zones, wards, departments, routing and SLAs.
- `nlp/ingest/`: polite crawler, extraction with OCR, chunking and indexing for the chatbot knowledge base. See [nlp/ingest/README.md](nlp/ingest/README.md).
- `nlp/eval/`: chatbot understanding and retrieval evaluations.

## Setup
Requirements:
- Node 20+, Python 3.12+, MongoDB, [Ollama](https://ollama.com).
- Tesseract OCR with Marathi and Hindi, for knowledge-base ingestion only.

```bash
ollama pull qwen3:8b
ollama pull bge-m3

cd backend && npm install && cp .env.example .env      # fill in the values
cd ../frontend && npm install
cd ../nlp && python -m venv venv && venv/Scripts/pip install -r requirements.txt && cp .env.example .env
```

Build the chatbot knowledge base from the `nlp` folder. The crawled data is not committed.
```bash
python -m ingest.crawler
python -m ingest.extract --ocr
python -m ingest.translate_titles
python -m ingest.chunk
python -m ingest.index
```

Start the services in this order: Ollama, then the NLP service (`python pipeline.py`, port 8000), the frontend (`npm run dev`, port 5173), and the backend last (`npm start`, port 5000). The backend warms up the model when it starts, so Ollama must already be running. Create an officer account with:
```bash
node backend/scripts/create_officer.js <email> <password> "<name>" [admin|agent] ["<department>"]
```

## Data and privacy
- Secrets live only in the `.env` files, which git ignores.
- Citizen uploads, crawled data, the OCR cache and the vector index are also kept out of git.
- The crawler fetches only public pages and respects robots.txt.
- PCMC staff orders that name employees are skipped.
