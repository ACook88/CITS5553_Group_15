# backend-esri/app/routers/analysis.py
# FastAPI router for analysis endpoints (summary, plots, comparison, export)
# This version makes /run_comparison tolerant to multiple payload shapes and avoids 422s.

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Body, Form
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any, Tuple, List

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
# Utilities
# ------------------------------------------------------------------------------

def _sanitize_for_json(df: pd.DataFrame, n: int = 5) -> Any:
    return df.head(n).to_dict(orient="records")

def _require_columns(df: pd.DataFrame, cols: Tuple[str, ...], df_name: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{df_name} missing required columns: {', '.join(missing)}"
        )

def _to_float_series(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")

def _safe_round_pair(df: pd.DataFrame, x: str, y: str, rounding: int) -> Tuple[pd.Series, pd.Series]:
    def _to_num(v):
        try:
            return float(v)
        except Exception:
            return np.nan
    xs = df[x].apply(_to_num)
    ys = df[y].apply(_to_num)
    if rounding is not None:
        try:
            r = int(rounding)
        except Exception:
            r = 6
        xs = xs.round(r)
        ys = ys.round(r)
    return xs.astype("float64"), ys.astype("float64")

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

    o = pd.DataFrame({
        "x": ox,
        "y": oy,
        "orig_val": _to_float_series(orig_df[orig_val])
    })
    d = pd.DataFrame({
        "x": dx,
        "y": dy,
        "dl_val": _to_float_series(dl_df[dl_val])
    })

    merged = o.merge(d, on=["x", "y"], how="inner")
    merged = merged.dropna(subset=["orig_val", "dl_val"]).copy()
    merged["residual"] = merged["dl_val"] - merged["orig_val"]
    return merged

def _first_present(payload: Dict[str, Any], keys: List[str]) -> Optional[Any]:
    for k in keys:
        if k in payload:
            v = payload[k]
            if v is None:
                continue
            if isinstance(v, str):
                if v.strip() == "":
                    continue
            return v
    return None

def _coerce_int(v: Any, default: int) -> int:
    try:
        return int(v)
    except Exception:
        return default

# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------

@router.post("/run_summary")
def run_summary(body: Dict[str, Any] = Body(...)) -> Any:
    run_token = _first_present(body, ["run_token", "token", "session", "session_token"])
    if not run_token:
        raise HTTPException(status_code=400, detail="Missing run_token")

    value_column = body.get("value_column") or body.get("value") or None

    try:
        orig_df, dl_df = get_session(str(run_token))
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
        "original": _describe(orig_df, value_column),
        "dl":        _describe(dl_df,   value_column),
    }

@router.post("/run_comparison")
def run_comparison(payload: Dict[str, Any] = Body(...)) -> Any:
    """
    Flexible parser that accepts multiple alias keys to avoid 422s from strict models.
    Expected logical fields (aliases allowed):
      - run_token | token | session | session_token
      - orig_x | original_x | origX
      - orig_y | original_y | origY
      - orig_val | original_val | origValue | originalValue
      - dl_x | dlX
      - dl_y | dlY
      - dl_val | dlValue
      - rounding
    """
    # Parse fields with aliases
    run_token = _first_present(payload, ["run_token", "token", "session", "session_token"])
    orig_x    = _first_present(payload, ["orig_x", "original_x", "origX"])
    orig_y    = _first_present(payload, ["orig_y", "original_y", "origY"])
    orig_val  = _first_present(payload, ["orig_val", "original_val", "origValue", "originalValue"])
    dl_x      = _first_present(payload, ["dl_x", "dlX"])
    dl_y      = _first_present(payload, ["dl_y", "dlY"])
    dl_val    = _first_present(payload, ["dl_val", "dlValue"])
    rounding  = _coerce_int(_first_present(payload, ["rounding"]), 6)

    # Human-friendly validation (400s with messages, not 422)
    missing = []
    if not run_token: missing.append("run_token")
    if not orig_x:    missing.append("orig_x")
    if not orig_y:    missing.append("orig_y")
    if not orig_val:  missing.append("orig_val")
    if not dl_x:      missing.append("dl_x")
    if not dl_y:      missing.append("dl_y")
    if not dl_val:    missing.append("dl_val")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")

    # Load session
    try:
        orig_df, dl_df = get_session(str(run_token))
    except KeyError:
        raise HTTPException(status_code=404, detail="run_token not found")

    # Run comparison
    merged = build_comparison(
        orig_df,
        dl_df,
        orig_x=str(orig_x),
        orig_y=str(orig_y),
        orig_val=str(orig_val),
        dl_x=str(dl_x),
        dl_y=str(dl_y),
        dl_val=str(dl_val),
        rounding=rounding,
    )

    return {
        "n_pairs": int(len(merged)),
        "preview": _sanitize_for_json(merged, n=5),
        "scatter": {
            "x": merged["orig_val"].tolist(),
            "y": merged["dl_val"].tolist(),
            "x_label": str(orig_val),
            "y_label": str(dl_val),
        },
        "residuals": {
            "values": merged["residual"].tolist(),
            "label": f"{dl_val} - {orig_val}",
        },
    }

@router.post("/run_comparison_files")
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

@router.post("/export_plots")
def export_plots(payload: Dict[str, Any] = Body(...)) -> Any:
    run_token = _first_present(payload, ["run_token", "token", "session", "session_token"])
    if not run_token:
        raise HTTPException(status_code=400, detail="Missing run_token")

    orig_x    = _first_present(payload, ["orig_x", "original_x", "origX"])
    orig_y    = _first_present(payload, ["orig_y", "original_y", "origY"])
    orig_val  = _first_present(payload, ["orig_val", "original_val", "origValue", "originalValue"])
    dl_x      = _first_present(payload, ["dl_x", "dlX"])
    dl_y      = _first_present(payload, ["dl_y", "dlY"])
    dl_val    = _first_present(payload, ["dl_val", "dlValue"])
    rounding  = _coerce_int(_first_present(payload, ["rounding"]), 6)

    missing = []
    if not orig_x:    missing.append("orig_x")
    if not orig_y:    missing.append("orig_y")
    if not orig_val:  missing.append("orig_val")
    if not dl_x:      missing.append("dl_x")
    if not dl_y:      missing.append("dl_y")
    if not dl_val:    missing.append("dl_val")
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")

    try:
        orig_df, dl_df = get_session(str(run_token))
    except KeyError:
        raise HTTPException(status_code=404, detail="run_token not found")

    merged = build_comparison(
        orig_df,
        dl_df,
        orig_x=str(orig_x),
        orig_y=str(orig_y),
        orig_val=str(orig_val),
        dl_x=str(dl_x),
        dl_y=str(dl_y),
        dl_val=str(dl_val),
        rounding=rounding,
    )

    out = io.StringIO()
    merged.to_csv(out, index=False)
    data = out.getvalue().encode("utf-8")

    return JSONResponse({
        "filename": str(payload.get("filename") or "comparison_export.csv"),
        "bytes_b64": io.BytesIO(data).getvalue().decode("latin1"),
        "n_rows": int(len(merged)),
    })
