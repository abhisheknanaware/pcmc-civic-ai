"""bge-m3 embeddings served by Ollama (GPU, next to the chat model). Used for both indexing and queries,
so the vectors always come from the same model build."""
import os

import httpx
import numpy as np

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
EMBED_MODEL = os.getenv("KB_EMBED_MODEL", "bge-m3")
EMBED_OPTIONS = {"num_ctx": 1024}  # chunks are <= ~600 tokens; a small context keeps GPU memory low


def embed(texts, timeout=120):
    response = httpx.post(f"{OLLAMA_URL}/api/embed", timeout=timeout, json={
        "model": EMBED_MODEL, "input": texts, "truncate": True, "keep_alive": "30m", "options": EMBED_OPTIONS,
    })
    response.raise_for_status()
    vectors = np.asarray(response.json()["embeddings"], dtype=np.float32)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
