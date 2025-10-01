from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, analysis
import os

app = FastAPI(title="CITS5553 API")

# Allow one or more origins via env:
# ALLOW_ORIGINS="https://your-frontend.onrender.com,http://localhost:5173"
allow_origins_env = os.getenv("ALLOW_ORIGINS", "*").strip()

if allow_origins_env == "*":
    allow_origins = ["*"]
    allow_credentials = False  # wildcard cannot be used with credentials
else:
    allow_origins = [o.strip() for o in allow_origins_env.split(",") if o.strip()]
    allow_credentials = os.getenv("ALLOW_CREDENTIALS", "false").lower() == "true"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(analysis.router)

@app.get("/api/health")
def health():
    return {"ok": True, "origins": allow_origins}
