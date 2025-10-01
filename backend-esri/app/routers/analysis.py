# backend-esri/app/routers/analysis.py
# FastAPI router for analysis endpoints (summary, plots, comparison, export)
# Key fix: run_comparison aligns rows USING THE USER-SELECTED COORDINATE COLUMNS
# instead of assuming SAMPLEID. If SAMPLEID happens to overlap, it will use it.

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Body, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, Tuple
import pandas as pd
import numpy as np
import io
import uuid
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# ------------------------------------------------------------------------------
# Simple in-memory session store. If your project already has one (e.g., in
# /api/data/columns), you can import and use that instead. This fallback lets
# run_comparison work both with a run_token or with direct file uploads.
# ------------------------------------------------------------------------------
SESSION_STORE: Dict[str, Dict[str, pd.DataFrame]] = {}


def put_session(token: str, orig_df: pd.DataFrame, dl_df: pd.DataFrame) -> None:
    SESSION_STORE[token] = {"orig": orig_df, "dl": dl_df}


def get_session(token: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if token not in SESSION_STORE:
        raise KeyError("Unknown run_token")
    return SESSION_STORE[token]["orig"], SESSION_STORE[token]["dl"]


# ------------------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------------------
def _coerce_num(df: pd.DataFrame, cols) -> None:
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")


def _read_csv_upload(upload: UploadFile) -> pd.DataFrame:
    try:
        raw = upload.file.read()
        return pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read CSV: {e}")


def _sanitize_for_json(df: pd.DataFrame, n: int = 5) -> Any:
    return df.head(n).to_dict(orient="records")


# ------------------------------------------------------------------------------
# Core comparison logic (the important part)
# ------------------------------------------------------------------------------
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
    rounding: int = 6,  # 6 works for both projected (mm to cm) & lat/long (~0.1 m)
) -> pd.DataFrame:
    required_o = {orig_x, orig_y, orig_val}
    required_d = {dl_x, dl_y, dl_val}
    if not required_o.issubset(orig_df.columns):
        missing = required_o - set(orig_df.columns)
        raise ValueError(f"Original file missing columns: {missing}")
    if not required_d.issubset(dl_df.columns):
        missing = required_d - set(dl_df.columns)
        raise ValueError(f"DL file missing columns: {missing}")

    # Optional: filter out spurious in the original set if present
    if "SPURIOUS" in orig_df.columns:
        orig_df = orig_df.loc[orig_df["SPURIOUS"] == 0].copy()

    # Coerce numeric
    _coerce_num(orig_df, [orig_x, orig_y, orig_val])
    _coerce_num(dl_df, [dl_x, dl_y, dl_val])

    # Drop rows without coordinates or values
    orig_df = orig_df.dropna(subset=[orig_x, orig_y, orig_val]).copy()
    dl_df = dl_df.dropna(subset=[dl_x, dl_y, dl_val]).copy()

    merged = pd.DataFrame()

    # If SAMPLEID overlaps (rare in your case), allow that join first
    if "SAMPLEID" in orig_df.columns and "SAMPLEID" in dl_df.columns:
        sid_inter = set(orig_df["SAMPLEID"]).intersection(set(dl_df["SAMPLEID"]))
        if len(sid_inter) > 0:
            merged = pd.merge(
                orig_df[["SAMPLEID", orig_x, orig_y, orig_val]].rename(
                    columns={orig_val: "orig_val"}
                ),
                dl_df[["SAMPLEID", dl_x, dl_y, dl_val]].rename(
                    columns={dl_val: "dl_val"}
                ),
                on="SAMPLEID",
                how="inner",
            )

    # Coordinate-based join using the columns the user selected in the UI
    if merged.empty:
        o = orig_df.copy()
        d = dl_df.copy()
        o["X_r"] = o[orig_x].round(rounding)
        o["Y_r"] = o[orig_y].round(rounding)
        d["X_r"] = d[dl_x].round(rounding)
        d["Y_r"] = d[dl_y].round(rounding)

        merged = pd.merge(
            o[["X_r", "Y_r", orig_val]].rename(columns={orig_val: "orig_val"}),
            d[["X_r", "Y_r", dl_val]].rename(columns={dl_val: "dl_val"}),
            on=["X_r", "Y_r"],
            how="inner",
        )

    # Clean up and add residual
    merged = merged.replace([np.inf, -np.inf], np.nan).dropna(
        subset=["orig_val", "dl_val"]
    )
    merged["residual"] = merged["dl_val"] - merged["orig_val"]
    return merged


# ------------------------------------------------------------------------------
# Request/Response models
# ------------------------------------------------------------------------------
class ComparisonRequest(BaseModel):
    run_token: Optional[str] = Field(
        None, description="Token referencing files uploaded earlier"
    )
    orig_x: str
    orig_y: str
    orig_val: str
    dl_x: str
    dl_y: str
    dl_val: str
    rounding: int = 6


class ComparisonResponse(BaseModel):
    n_pairs: int
    preview: Any
    scatter: Dict[str, Any]
    residuals: Dict[str, Any]


# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------

@router.post("/run_comparison", response_model=ComparisonResponse)
def run_comparison(payload: ComparisonRequest = Body(...)) -> Any:
    """
    Pairs rows from the two CSVs using the columns the user selected in the UI.
    If run_token is supplied and found, uses cached dataframes from the /api/data flow.
    """
    try:
        if payload.run_token:
            try:
                orig_df, dl_df = get_session(payload.run_token)
            except KeyError:
                raise HTTPException(status_code=404, detail="run_token not found")
        else:
            # If your pipeline always uses run_token, we can require it.
            # But for flexibility, fail with a clear error:
            raise HTTPException(
                status_code=400,
                detail="Missing run_token. Use /api/data/columns first or call /run_comparison_files with CSV uploads.",
            )

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

        n = int(len(merged))
        # Light-weight payload for plotting on the frontend
        # (If you already shape Plotly traces elsewhere, adapt as needed.)
        resp = {
            "n_pairs": n,
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
        return JSONResponse(resp)

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("run_comparison failed")
        raise HTTPException(status_code=500, detail=f"run_comparison failed: {e}")


@router.post("/run_comparison_files", response_model=ComparisonResponse)
def run_comparison_files(
    # Accept files directly if you want to bypass run_token
    original: UploadFile = File(..., description="Original CSV"),
    dl: UploadFile = File(..., description="DL CSV"),
    orig_x: str = Form(...),
    orig_y: str = Form(...),
    orig_val: str = Form(...),
    dl_x: str = Form(...),
    dl_y: str = Form(...),
    dl_val: str = Form(...),
    rounding: int = Form(6),
) -> Any:
    try:
        orig_df = _read_csv_upload(original)
        dl_df = _read_csv_upload(dl)

        # Optionally stash a session for follow-up calls
        token = str(uuid.uuid4())
        put_session(token, orig_df, dl_df)

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
        n = int(len(merged))
        resp = {
            "n_pairs": n,
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
            # Expose the token in case the FE wants to reuse it
            "run_token": token,
        }
        return JSONResponse(resp)

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("run_comparison_files failed")
        raise HTTPException(status_code=500, detail=f"run_comparison_files failed: {e}")


# ------------------------------------------------------------------------------
# (Optional) Stubs for other analysis endpoints your FE might call.
# Keep or remove depending on your project.
# ------------------------------------------------------------------------------

class SummaryRequest(BaseModel):
    run_token: Optional[str] = None
    value_column: Optional[str] = None


@router.post("/run_summary")
def run_summary(payload: SummaryRequest = Body(...)) -> Any:
    try:
        if not payload.run_token:
            raise HTTPException(status_code=400, detail="run_token is required")
        orig_df, dl_df = get_session(payload.run_token)

        col = payload.value_column or "Te_ppm"
        _coerce_num(orig_df, [col])
        _coerce_num(dl_df, [col])

        summary = {
            "original": {
                "rows": int(len(orig_df)),
                "cols": list(orig_df.columns),
                "value_stats": orig_df[col].describe().to_dict()
                if col in orig_df.columns
                else None,
            },
            "dl": {
                "rows": int(len(dl_df)),
                "cols": list(dl_df.columns),
                "value_stats": dl_df[col].describe().to_dict()
                if col in dl_df.columns
                else None,
            },
        }
        return JSONResponse(summary)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("run_summary failed")
        raise HTTPException(status_code=500, detail=f"run_summary failed: {e}")


class ExportRequest(BaseModel):
    run_token: str
    filename: Optional[str] = "comparison_export.csv"
    # repeat the mapping so export matches the same pairing
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
        csv_bytes = merged.to_csv(index=False).encode("utf-8")
        # Return inlined to keep things simple; adapt to your storage as needed
        return JSONResponse(
            {
                "filename": payload.filename,
                "bytes_b64": base64.b64encode(csv_bytes).decode("utf-8"),
                "n_rows": int(len(merged)),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("export_plots failed")
        raise HTTPException(status_code=500, detail=f"export_plots failed: {e}")


