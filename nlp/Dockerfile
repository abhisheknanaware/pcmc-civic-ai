FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Tesseract with Marathi + Hindi for OCR of scanned PCMC circulars during the weekly refresh
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-mar tesseract-ocr-hin \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# CPU build of PyTorch keeps the image ~3 GB smaller; the heavy LLM work runs in the Ollama container.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
COPY --from=config pcmc.json /config/pcmc.json
EXPOSE 8000
CMD ["python", "pipeline.py"]
