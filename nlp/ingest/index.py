"""Embed chunks with bge-m3 (served by Ollama on the GPU) and store them in a local Qdrant collection.

Only chunks whose text changed are re-embedded (keyed by chunk_id + content hash), so weekly
re-crawls are cheap. Qdrant runs embedded in this process (data/qdrant) - no extra server.

Usage:  python -m ingest.index [--rebuild]
"""
import argparse
import hashlib
import json
import time
import uuid

from .chunk import CHUNKS_PATH
from .crawler import DATA

QDRANT_PATH = DATA.parent / "qdrant"
COLLECTION = "pcmc_kb"
DIM = 1024


def point_id(chunk_id):
    return str(uuid.UUID(hashlib.md5(chunk_id.encode()).hexdigest()))


def text_hash(chunk):
    return hashlib.sha1(chunk["text"].encode()).hexdigest()


def main():
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, PointStruct, VectorParams, PayloadSchemaType
    from chat.embeddings import embed

    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    chunks = [json.loads(l) for l in CHUNKS_PATH.read_text(encoding="utf-8").splitlines()]
    client = QdrantClient(path=str(QDRANT_PATH))
    if args.rebuild and client.collection_exists(COLLECTION):
        client.delete_collection(COLLECTION)
    if not client.collection_exists(COLLECTION):
        client.create_collection(COLLECTION, vectors_config=VectorParams(size=DIM, distance=Distance.COSINE))
        for field in ("status", "category", "language", "department", "topic"):
            client.create_payload_index(COLLECTION, field, PayloadSchemaType.KEYWORD)

    existing = {}
    offset = None
    while True:
        points, offset = client.scroll(COLLECTION, limit=512, offset=offset, with_payload=["chunk_id", "text_hash"])
        existing.update({p.id: p.payload.get("text_hash") for p in points})
        if offset is None:
            break

    wanted = {point_id(c["chunk_id"]): c for c in chunks}
    stale = [pid for pid in existing if pid not in wanted]
    todo = [c for pid, c in wanted.items() if existing.get(pid) != text_hash(c)]
    if stale:
        client.delete(COLLECTION, points_selector=stale)
    print(f"{len(chunks)} chunks: {len(todo)} to embed, {len(stale)} removed, {len(chunks) - len(todo)} unchanged")
    if not todo:
        return

    start = time.time()
    batch = 32
    for i in range(0, len(todo), batch):
        part = todo[i:i + batch]
        vectors = embed([c["text"] for c in part])
        client.upsert(COLLECTION, points=[
            PointStruct(id=point_id(c["chunk_id"]), vector=v.tolist(), payload={**c, "text_hash": text_hash(c)})
            for c, v in zip(part, vectors)
        ])
        done = i + len(part)
        print(f"  embedded {done}/{len(todo)} ({done / (time.time() - start):.1f} chunks/s)", flush=True)
    print(f"index ready: {client.count(COLLECTION).count} points in {QDRANT_PATH}")


if __name__ == "__main__":
    main()
