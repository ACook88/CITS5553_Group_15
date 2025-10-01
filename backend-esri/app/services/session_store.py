# Simple in-memory session storage for uploaded dataframes.
# Stores: run_token -> (orig_df, dl_df)
# NOTE: This is ephemeral (clears on restart). Good enough for a stateless Render dyno.

from __future__ import annotations
from typing import Tuple
import threading
import pandas as pd

_LOCK = threading.RLock()
_STORE: dict[str, Tuple[pd.DataFrame, pd.DataFrame]] = {}
_MAX_SESSIONS = 1000  # simple cap to avoid unbounded memory

def put_session(token: str, orig_df: pd.DataFrame, dl_df: pd.DataFrame) -> None:
    with _LOCK:
        if len(_STORE) >= _MAX_SESSIONS:
            # Evict an arbitrary (oldest-ish) item
            try:
                _STORE.pop(next(iter(_STORE)))
            except StopIteration:
                pass
        _STORE[token] = (orig_df, dl_df)

def get_session(token: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
    with _LOCK:
        if token not in _STORE:
            raise KeyError("run_token not found")
        return _STORE[token]
