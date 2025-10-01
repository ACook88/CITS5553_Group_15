# backend-esri/app/routers/data.py
# Issues a run_token after reading two CSVs and returns their column names.
# The token references in-memory dataframes stored via app.services.session_store.

from __future__ import annotations

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import uuid
import logging

from app.services.csv_service import read_csv_upload
from app.services.session_store import put_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])

class ColumnsResponse(BaseModel):
    original_columns: list[str]
    dl_columns: list[str]
    run_token: str

@router.post("/columns", response_model=ColumnsResponse)
async def get_columns(
    original: UploadFile = File(...),
    dl: UploadFile       = File(...),
) -> Any:
    """
    Accepts two files: original and dl (each .csv or .zip with a .csv inside).
    Reads both, stores them in an in-memory session, returns their column names and a run_token.
    """
    try:
        orig_df = await read_csv_upload(original)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read 'original': {e}")

    try:
        dl_df = await read_csv_upload(dl)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read 'dl': {e}")

    token = str(uuid.uuid4())
    put_session(token, orig_df, dl_df)

    return {
        "original_columns": [str(c) for c in orig_df.columns.tolist()],
        "dl_columns": [str(c) for c in dl_df.columns.tolist()],
        "run_token": token,
    }
