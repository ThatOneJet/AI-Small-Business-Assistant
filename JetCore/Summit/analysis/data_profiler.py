"""data_profiler.py -- adaptive data ingestion for the AI assistant.

Takes ANY common data file (csv, tsv, txt, json, xlsx/xls, parquet), loads it with
pandas, and figures out what it is: it infers each column's category
(numeric / date / categorical / text / identifier / boolean) and builds a compact,
structured digest the local LLM can reason over -- instead of dumping raw bytes.

Non-tabular files fall back to a plain-text snippet, so nothing breaks.
"""
import os
import json
import pandas as pd
import pandas.api.types as pt

# extension -> loader kind
SUPPORTED = {
    ".csv": "csv", ".tsv": "tsv", ".txt": "text",
    ".json": "json", ".ndjson": "json",
    ".xlsx": "excel", ".xls": "excel", ".xlsm": "excel",
    ".parquet": "parquet",
}


def load_dataframe(path):
    """Best-effort load of ``path`` into a DataFrame.

    Returns (df, None) on success, or (None, text_snippet) when the file isn't
    tabular (so the caller can still feed the text to the model).
    """
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".csv":
            return pd.read_csv(path), None
        if ext == ".tsv":
            return pd.read_csv(path, sep="\t"), None
        if ext in (".xlsx", ".xls", ".xlsm"):
            return pd.read_excel(path), None
        if ext == ".parquet":
            return pd.read_parquet(path), None
        if ext in (".json", ".ndjson"):
            try:
                return pd.read_json(path, lines=(ext == ".ndjson")), None
            except ValueError:
                with open(path) as f:
                    return pd.json_normalize(json.load(f)), None
        # .txt / unknown: sniff a delimiter; if it looks tabular use it, else text
        try:
            df = pd.read_csv(path, sep=None, engine="python")
            if df.shape[1] > 1:
                return df, None
        except Exception:
            pass
        with open(path, errors="ignore") as f:
            return None, f.read(4000)
    except Exception:
        try:
            with open(path, errors="ignore") as f:
                return None, f.read(4000)
        except Exception as e:
            return None, f"(could not read file: {e})"


def categorize_column(s):
    """Infer a semantic category for a pandas Series."""
    if pt.is_bool_dtype(s):
        return "boolean"
    if pt.is_numeric_dtype(s):
        return "numeric"
    if pt.is_datetime64_any_dtype(s):
        return "date"
    non_null = s.dropna()
    if not len(non_null):
        return "unknown"
    # object/string: is it really dates?
    try:
        parsed = pd.to_datetime(non_null.head(25), errors="coerce", format="mixed")
        if parsed.notna().mean() > 0.8:
            return "date"
    except Exception:
        pass
    n, nunique = len(non_null), non_null.nunique()
    if nunique <= max(20, 0.05 * n) and nunique < n:
        return "categorical"
    avg_len = non_null.astype(str).str.len().mean()
    if nunique == n and avg_len < 40:
        return "identifier"
    return "text"


def profile_dataframe(df, name, max_cols=40, sample_rows=3):
    """Compact, categorized digest of a DataFrame for the LLM."""
    L = [f"### FILE: {name}",
         f"shape: {df.shape[0]} rows x {df.shape[1]} columns",
         "columns (name [category] summary):"]
    for col in df.columns[:max_cols]:
        s = df[col]
        cat = categorize_column(s)
        detail = ""
        try:
            if cat == "numeric":
                detail = f"min={s.min():.4g} max={s.max():.4g} mean={s.mean():.4g}"
            elif cat in ("categorical", "boolean"):
                vc = s.value_counts().head(5)
                detail = "top: " + ", ".join(f"{k} ({v})" for k, v in vc.items())
            elif cat == "date":
                d = pd.to_datetime(s, errors="coerce", format="mixed")
                detail = f"range {d.min()} .. {d.max()}"
            else:
                detail = f"{s.nunique()} unique values"
        except Exception:
            pass
        missing = int(s.isna().sum())
        L.append(f"  - {col} [{cat}] {detail}" + (f"  ({missing} missing)" if missing else ""))
    if len(df.columns) > max_cols:
        L.append(f"  ...and {len(df.columns) - max_cols} more columns")
    L.append("sample rows:")
    try:
        L.append(df.head(sample_rows).to_csv(index=False).strip())
    except Exception:
        pass
    return "\n".join(L)


def profile_file(path):
    """Return a categorized digest for any file (or a text snippet if non-tabular)."""
    name = os.path.basename(path)
    df, text = load_dataframe(path)
    if df is not None:
        try:
            return profile_dataframe(df, name)
        except Exception as e:
            return f"### FILE: {name}\n(loaded but could not profile: {e})"
    return f"### FILE: {name} (non-tabular text)\n{(text or '').strip()[:4000]}"
