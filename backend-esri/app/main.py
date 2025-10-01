from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import data, analysis
import os

app = FastAPI(title="CITS5553 API")

# Comma-separated list, e.g.
# ALLOW_ORIGINS=https://your-frontend.onrender.com,https://another-site.com
_allow_origins = os.getenv("ALLOW_ORIGINS", "*").strip()
if _allow_origins == "*":
    allow_origins = ["*"]
    allow_credentials = False  # cannot use credentials with wildcard
else:
    allow_origins = [o.strip() for o in _allow_origins.split(",") if o.strip()]
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
