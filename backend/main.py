from __future__ import annotations

import os
import time
import uuid
import socket
import csv
from collections import deque
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from gemini_service import get_scan_explanation
from inference import YOLOBrainTumorEngine

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
DEFAULT_MODEL_CANDIDATES = [
    BASE_DIR / "models" / "final.pt",
    BASE_DIR / "runs" / "brain_tumor_classifier" / "weights" / "final.pt",
    BASE_DIR / "runs" / "brain_tumor_classifier" / "weights" / "best.pt",
    BASE_DIR / "models" / "best.pt",
    BASE_DIR / "models" / "detection.pt",
    BASE_DIR / "runs" / "brain_tumor_detector" / "weights" / "best.pt",
]
RUN_DIRECTORIES = [
    BASE_DIR / "runs" / "brain_tumor_classifier",
    BASE_DIR / "runs" / "brain_tumor_detector",
]
RECENT_ANALYSIS_LOGS: deque[dict[str, object]] = deque(maxlen=120)
MODEL_PATH = Path(os.getenv("MODEL_PATH", ""))
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.25"))
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "20"))

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Brain Tumor AI API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not str(MODEL_PATH) or str(MODEL_PATH) == ".":
    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate.exists():
            MODEL_PATH = candidate
            break
    else:
        MODEL_PATH = DEFAULT_MODEL_CANDIDATES[0]

engine = YOLOBrainTumorEngine(MODEL_PATH, CONF_THRESHOLD)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def validate_upload(filename: str | None, size: int) -> Path:
    if not filename:
        raise HTTPException(400, "Missing filename")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported image format: {ext}")
    if size > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {MAX_FILE_MB} MB limit")
    return Path(filename)


async def save_upload(file: UploadFile) -> Path:
    data = await file.read()
    validate_upload(file.filename, len(data))
    target = UPLOAD_DIR / f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    target.write_bytes(data)
    return target


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "backend": "online",
        "model_loaded": engine.loaded,
        "model_path": str(MODEL_PATH),
        "device": engine.device,
    }


@app.get("/")
def root():
    return {
        "status": "ok",
        "app": "Brain Tumor AI",
        "health": "/api/health",
        "model": "/api/model",
        "analyze": "/api/analyze",
        "batch_analyze": "/api/analyze/batch",
    }


@app.get("/api/model")
def model_info():
    return engine.info()


def _read_results_csv(csv_path: Path, limit: int = 12) -> list[dict[str, str]]:
    if not csv_path.exists():
        return []
    try:
        with csv_path.open("r", encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except Exception:
        return []
    return rows[-limit:]


@app.get("/api/model/logs")
def model_logs():
    return {
        "model_path": str(MODEL_PATH),
        "active_device": engine.device,
        "recent_upload_logs": list(RECENT_ANALYSIS_LOGS),
        "logs": [
            {
                "source": "classifier",
                "lines": [
                    "upload logs are shown below",
                    "mode: classification",
                ],
            },
            {
                "source": "detector",
                "lines": [
                    "upload logs are shown below",
                    "mode: detection",
                ],
            },
        ],
    }


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    path = await save_upload(file)
    started = time.perf_counter()
    try:
        result = engine.predict(path)
        result["filename"] = Path(file.filename or path.name).name
        result["request_id"] = uuid.uuid4().hex
        result["processing_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
        RECENT_ANALYSIS_LOGS.appendleft(
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "request_id": result["request_id"],
                "filename": result["filename"],
                "task": result.get("task", "classification"),
                "status": result.get("status", "success"),
                "tumor_detected": result.get("tumor_detected"),
                "predicted_type": result.get("predicted_type"),
                "best_confidence": result.get("best_confidence"),
                "processing_time_ms": result.get("processing_time_ms"),
                "detections": result.get("detections", []),
            }
        )
        return result
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/api/explain")
async def explain(file: UploadFile = File(...)):
    path = await save_upload(file)
    started = time.perf_counter()
    try:
        classification = engine.predict(path)
        explanation = get_scan_explanation(path, classification)
        request_id = uuid.uuid4().hex
        processing_time_ms = round((time.perf_counter() - started) * 1000, 2)
        RECENT_ANALYSIS_LOGS.appendleft(
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "request_id": request_id,
                "filename": Path(file.filename or path.name).name,
                "task": classification.get("task", "classification"),
                "status": classification.get("status", "success"),
                "tumor_detected": classification.get("tumor_detected"),
                "predicted_type": classification.get("predicted_type"),
                "best_confidence": classification.get("best_confidence"),
                "processing_time_ms": processing_time_ms,
                "detections": classification.get("detections", []),
            }
        )
        return {
            "classification": classification,
            "explanation": explanation,
            "filename": Path(file.filename or path.name).name,
            "processing_time_ms": processing_time_ms,
        }
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass


@app.post("/api/analyze/batch")
async def analyze_batch(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No files supplied")
    results = []
    for file in files:
        path = await save_upload(file)
        started = time.perf_counter()
        try:
            result = engine.predict(path)
            result["filename"] = Path(file.filename or path.name).name
            result["request_id"] = uuid.uuid4().hex
            result["processing_time_ms"] = round((time.perf_counter() - started) * 1000, 2)
            results.append(result)
            RECENT_ANALYSIS_LOGS.appendleft(
                {
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "request_id": result["request_id"],
                    "filename": result["filename"],
                    "task": result.get("task", "classification"),
                    "status": result.get("status", "success"),
                    "tumor_detected": result.get("tumor_detected"),
                    "predicted_type": result.get("predicted_type"),
                    "best_confidence": result.get("best_confidence"),
                    "processing_time_ms": result.get("processing_time_ms"),
                    "detections": result.get("detections", []),
                }
            )
        finally:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
    return {"count": len(results), "results": results}


@app.get("/api/annotated/{filename}")
def annotated(filename: str):
    safe = Path(filename).name
    path = OUTPUT_DIR / safe
    if not path.exists():
        raise HTTPException(404, "Annotated image not found")
    return FileResponse(path)


def find_free_port(start_port: int, host: str = "127.0.0.1", search_limit: int = 50) -> int:
    for port in range(start_port, start_port + search_limit):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No free port found from {start_port} to {start_port + search_limit - 1}")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    requested_port = int(os.getenv("PORT", "8000"))
    search_limit = int(os.getenv("PORT_SEARCH_LIMIT", "50"))
    port = find_free_port(requested_port, host=host, search_limit=search_limit)
    print(f"Backend hosting link: http://{host}:{port}/api/health", flush=True)
    uvicorn.run("main:app", host=host, port=port, reload=False)
