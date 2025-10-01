# Utilities to read uploaded CSVs (supports .csv and simple .zip containing a CSV)

from __future__ import annotations
from fastapi import UploadFile
import pandas as pd
import zipfile
import io

async def read_csv_upload(file: UploadFile) -> pd.DataFrame:
    name = (file.filename or "").lower()
    data = await file.read()
    if name.endswith(".zip"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                # pick the first .csv in the archive
                csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
                if not csv_names:
                    raise ValueError("No .csv files inside the ZIP")
                with zf.open(csv_names[0], "r") as f:
                    raw = f.read()
                return _read_csv_bytes(raw)
        except zipfile.BadZipFile as e:
            raise ValueError(f"Invalid ZIP file: {e}")
    elif name.endswith(".csv"):
        return _read_csv_bytes(data)
    else:
        raise ValueError("Unsupported file type. Please upload .csv or .zip containing a .csv")

def _read_csv_bytes(b: bytes) -> pd.DataFrame:
    # Try utf-8-sig then fallback to latin-1 to be resilient to BOM/encodings
    bio = io.BytesIO(b)
    try:
        return pd.read_csv(bio, low_memory=False)
    except UnicodeDecodeError:
        bio.seek(0)
        return pd.read_csv(bio, low_memory=False, encoding="latin1")
