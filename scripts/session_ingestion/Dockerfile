FROM python:3.12.12-slim-bookworm

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY scripts/session_ingestion/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt

COPY scripts/session_ingestion/worker.py ./worker.py

RUN useradd --create-home --uid 10001 worker \
    && chown -R worker:worker /app
USER worker

CMD ["python", "worker.py"]
