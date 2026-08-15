# Brain Tumor AI

Brain MRI analysis project built with React + Vite on the frontend and FastAPI + Python on the backend. This is an AI-assisted research and education prototype, not a medical diagnostic device.

## Project Structure

- `frontend/` - React + Vite UI
- `backend/` - FastAPI API and model inference
- `dev.js` - local desktop/dev launcher
- `generate_report.py` - report generator

## Requirements

- Python 3.10+
- Node.js 18+
- A trained YOLO model file

## Model File

Put the trained model at:

`backend/models/best.pt`

Optional environment variables:

- `MODEL_PATH` - custom model path
- `CONF_THRESHOLD` - default confidence threshold, for example `0.25`
- `MAX_FILE_MB` - upload size limit, default `20`

## Run Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Backend health endpoint:

- `GET /api/health`

## Run Frontend

```bash
cd frontend
npm install
npm run dev:web
```

If you want the combined desktop/dev flow:

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

- `GET /api/health`
- `GET /api/model`
- `GET /api/model/logs`
- `POST /api/analyze`
- `POST /api/analyze/batch`
- `POST /api/explain`
- `GET /api/annotated/{filename}`

## Frontend API URL

The frontend reads the backend URL from:

- `VITE_API_BASE_URL`

If that is not set, it falls back to `/api` and local development URLs.

## Deploying

### Railway backend

Deploy the `backend/` folder as a separate Railway service.

Recommended start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Set these environment variables on Railway if needed:

- `MODEL_PATH=backend/models/best.pt`
- `CONF_THRESHOLD=0.25`
- `MAX_FILE_MB=20`

### Netlify frontend

Deploy the `frontend/` folder to Netlify.

Build settings:

- Build command: `npm run build`
- Publish directory: `dist`

Set this Netlify environment variable to your Railway backend URL:

- `VITE_API_BASE_URL=https://your-railway-service.up.railway.app`

## Notes

- The backend allows CORS for all origins.
- The UI is model-agnostic and will display the class names from the loaded model.
- `No Tumor` is usually represented by the absence of detections in a YOLO workflow.
