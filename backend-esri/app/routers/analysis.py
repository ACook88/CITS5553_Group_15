# backend-esri/app/routers/analysis.py
# FastAPI router for analysis endpoints (summary, plots, comparison, export)
# Pairs rows using the USER-SELECTED coordinate and assay columns.

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Body, Form
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, Tuple
from fastapi.responses import JSONResponse

import pandas as pd
import numpy as np
import io
import uuid
import logging

from app.services.session_store import get_session, put_session
from app.services.csv_service import read_csv_upload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# ------------------------------------------------------------------------------
# Models
# ------------------------------------------------------------------------------

class SummaryRequest(BaseModel):
    run_token: str
    value_column: Optional[str] = None

class SummaryResponse(BaseModel):
    original: Dict[str, Any]
    dl: Dict[str, Any]

class ComparisonRequest(BaseModel):
    run_token: Optional[str] = Field(None, description="Token issued by /api/data/columns")
    orig_x: str
    orig_y: str
    orig_val: str
    dl_x: str
    dl_y: str
    dl_val: str
    rounding: int = 6

    model_config = {"extra": "ignore"}  # ignore unexpected keys gracefully

class ComparisonResponse(BaseModel):
    n_pairs: int
    preview: Any
    scatter: Dict[str, Any]
    residuals: Dict[str, Any]
    run_token: Optional[str] = None  # present when /run_comparison_files used

# ------------------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------------------

def _sanitize_for_json(df: pd.DataFrame, n: int = 5) -> Any:
    return df.head(n).to_dict(orient="records")

def _require_columns(df: pd.DataFrame, cols: Tuple[str, ...], df_name: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"{df_name} missing required columns: {', '.join(missing)}"
        )

def _safe_round_pair(df: pd.DataFrame, x: str, y: str, rounding: int) -> pd.Series:
    # Robust rounding: handles ints/floats/strings that parse as floats
    def _to_num(s):
        try:
            return float(s)
        except Exception:
            return np.nan
    return (
        pd.Series(df[x].apply(_to_num).round(rounding).astype("float64"), index=df.index).astype("float64"),
        pd.Series(df[y].apply(_to_num).round(rounding).astype("float64"), index=df.index).astype("float64"),
    )

def build_comparison(
    orig_df: pd.DataFrame,
    dl_df: pd.DataFrame,
    *,
    orig_x: str,
    orig_y: str,
    orig_val: str,
    dl_x: str,
    dl_y: str,
    dl_val: str,
    rounding: int = 6,
) -> pd.DataFrame:
    _require_columns(orig_df, (orig_x, orig_y, orig_val), "original")
    _require_columns(dl_df,   (dl_x, dl_y, dl_val),       "dl")

    ox, oy = _safe_round_pair(orig_df, orig_x, orig_y, rounding)
    dx, dy = _safe_round_pair(dl_df,   dl_x,   dl_y,   rounding)

    o = pd.DataFrame({"x": ox, "y": oy, "orig_val": pd.to_numeric(orig_df[orig_val], errors="coerce")})
    d = pd.DataFrame({"x": dx, "y": dy, "dl_val":   pd.to_numeric(dl_df[dl_val],   errors="coerce")})

    merged = o.merge(d, on=["x", "y"], how="inner")
    merged = merged.dropna(subset=["orig_val", "dl_val"]).copy()
    merged["residual"] = merged["dl_val"] - merged["orig_val"]
    return merged

# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------

@router.post("/run_summary", response_model=SummaryResponse)
def run_summary(body: SummaryRequest = Body(...)) -> Any:
    try:
        orig_df, dl_df = get_session(body.run_token)
    except KeyError:
        raise HTTPException(status_code=404, detail="run_token not found")

    def _describe(df: pd.DataFrame, value_col: Optional[str]) -> Dict[str, Any]:
        d = {"rows": int(df.shape[0]), "cols": list(map(str, df.columns))}
        if value_col and value_col in df.columns:
            s = pd.to_numeric(df[value_col], errors="coerce").dropna()
            d["value_stats"] = {
                "count": int(s.count()),
                "mean": float(s.mean()) if len(s) else None,
                "std":  float(s.std())  if len(s) else None,
                "min":  float(s.min())  if len(s) else None,
                "max":  float(s.max())  if len(s) else None,
            }
        return d

    return {
        "original": _describe(orig_df, body.value_column),
        "dl":        _describe(dl_df,   body.value_column),
    }

@router.post("/run_comparison", response_model=ComparisonResponse)
def run_comparison(payload: ComparisonRequest = Body(...)) -> Any:
    # Explicit presence checks for readable 422 messages
    for k in ("orig_x","orig_y","orig_val","dl_x","dl_y","dl_val"):
        v = getattr(payload, k, None)
        if v is None or (isinstance(v, str) and v.strip() == ""):
            raise HTTPException(status_code=422, detail=f"Field '{k}' is required and cannot be empty")

    if not payload.run_token:
        raise HTTPException(
            status_code=400,
            detail="Missing run_token. Call /api/data/columns first, or use /run_comparison_files to upload CSVs directly."
        )

    try:
        orig_df, dl_df = get_session(payload.run_token)
    except KeyError:
        raise HTTPException(status_code=404, detail="run_token not found")

    merged = build_comparison(
        orig_df,
        dl_df,
        orig_x=payload.orig_x,
        orig_y=payload.orig_y,
        orig_val=payload.orig_val,
        dl_x=payload.dl_x,
        dl_y=payload.dl_y,
        dl_val=payload.dl_val,
        rounding=payload.rounding,
    )

    return {
        "n_pairs": int(len(merged)),
        "preview": _sanitize_for_json(merged, n=5),
        "scatter": {
            "x": merged["orig_val"].tolist(),
            "y": merged["dl_val"].tolist(),
            "x_label": payload.orig_val,
            "y_label": payload.dl_val,
        },
        "residuals": {
            "values": merged["residual"].tolist(),
            "label": f"{payload.dl_val} - {payload.orig_val}",
        },
    }

@router.post("/run_comparison_files", response_model=ComparisonResponse)
async def run_comparison_files(
    original: UploadFile = File(...),
    dl: UploadFile       = File(...),
    orig_x: str = Form(...),
    orig_y: str = Form(...),
    orig_val: str = Form(...),
    dl_x: str = Form(...),
    dl_y: str = Form(...),
    dl_val: str = Form(...),
    rounding: int = Form(6),
) -> Any:
    try:
        orig_df = await read_csv_upload(original)
        dl_df   = await read_csv_upload(dl)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read CSV: {e}")

    merged = build_comparison(
        orig_df,
        dl_df,
        orig_x=orig_x,
        orig_y=orig_y,
        orig_val=orig_val,
        dl_x=dl_x,
        dl_y=dl_y,
        dl_val=dl_val,
        rounding=rounding,
    )

    token = str(uuid.uuid4())
    put_session(token, orig_df, dl_df)

    return {
        "n_pairs": int(len(merged)),
        "preview": _sanitize_for_json(merged, n=5),
        "scatter": {
            "x": merged["orig_val"].tolist(),
            "y": merged["dl_val"].tolist(),
            "x_label": orig_val,
            "y_label": dl_val,
        },
        "residuals": {
            "values": merged["residual"].tolist(),
            "label": f"{dl_val} - {orig_val}",
        },
        "run_token": token,
    }

class ExportRequest(BaseModel):
    run_token: str
    filename: Optional[str] = "comparison_export.csv"
    orig_x: str
    orig_y: str
    orig_val: str
    dl_x: str
    dl_y: str
    dl_val: str
    rounding: int = 6

@router.post("/export_plots")
def export_plots(payload: ExportRequest = Body(...)) -> Any:
    try:
        orig_df, dl_df = get_session(payload.run_token)
    except KeyError:
        raise HTTPException(status_code=404, detail="run_token not found")

    merged = build_comparison(
        orig_df,
        dl_df,
        orig_x=payload.orig_x,
        orig_y=payload.orig_y,
        orig_val=payload.orig_val,
        dl_x=payload.dl_x,
        dl_y=payload.dl_y,
        dl_val=payload.dl_val,
        rounding=payload.rounding,
    )

    out = io.StringIO()
    merged.to_csv(out, index=False)
    data = out.getvalue().encode("utf-8")

    # Return small JSON wrapper (frontend already decodes this)
    return JSONResponse({
        "filename": payload.filename or "comparison_export.csv",
        "bytes_b64": io.BytesIO(data).getvalue().decode("latin1"),  # cheap transport; FE simply re-encodes
        "n_rows": int(len(merged)),
    })
