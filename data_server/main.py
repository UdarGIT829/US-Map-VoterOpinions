# main.py
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Civic Data API (stub)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Models ---------------------------------------------------------------

class DataRequest(BaseModel):
    demographics: bool = Field(True, description="Include demographics object")
    political_party: bool = Field(True, description="Include political_party object")
    requested_fips: List[str] = Field(..., description="List of FIPS codes")

class PerFipsPayload(BaseModel):
    demographics: Optional[Dict[str, Any]] = None
    political_party: Optional[Dict[str, Any]] = None

class DataResponse(BaseModel):
    response_fips: Dict[str, PerFipsPayload]

# ----- Helpers --------------------------------------------------------------

def _level_for_fips(fips: str) -> str:
    f = fips.strip()
    if not f.isdigit():
        return "unknown"
    return "state" if len(f) <= 2 else "county" if len(f) == 5 else "unknown"

def _seed_from_fips(fips: str) -> int:
    return sum(ord(c) for c in fips) or 1

def _stub_demographics(fips: str, level: str) -> Dict[str, Any]:
    s = _seed_from_fips(fips)
    pop = 10_000 + (s % 900_000)
    age = round(30 + (s % 200) / 10, 1)       # ~30.0–49.9
    hh  = 3_000 + (s % 70_000)
    inc = 40_000 + (s % 60_000)
    print({
        "level": level,
        "population": pop,
        "median_age": age,
        "households": hh,
        "median_household_income": inc,
    })
    return {
        "level": level,
        "population": pop,
        "median_age": age,
        "households": hh,
        "median_household_income": inc,
    }

def _stub_political_party(fips: str, level: str) -> Dict[str, Any]:
    s = _seed_from_fips(fips)
    d = 40 + (s % 31)      # 40–70
    r = 25 + (s % 26)      # 25–50
    o = max(0, 100 - d - r)
    total = d + r + o or 1
    return {
        "level": level,
        "share": {
            "democratic": round(d / total, 3),
            "republican": round(r / total, 3),
            "other":      round(o / total, 3),
        }
    }

# ----- Routes ---------------------------------------------------------------

@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}

@app.post(
    "/data/",
    response_model=DataResponse,
    response_model_exclude_none=True,
)
def get_data(req: DataRequest) -> DataResponse:
    if not req.requested_fips:
        raise HTTPException(status_code=400, detail="requested_fips cannot be empty")

    out: Dict[str, PerFipsPayload] = {}

    for fips in req.requested_fips:
        level = _level_for_fips(fips)
        if level == "unknown":
            # Still return a shell so caller can see errors per-FIPS
            out[fips] = PerFipsPayload(
                demographics={"error": "unknown FIPS format"},
                political_party={"error": "unknown FIPS format"},
            )
            continue

        demo = _stub_demographics(fips, level) if req.demographics else None
        party = _stub_political_party(fips, level) if req.political_party else None
        out[fips] = PerFipsPayload(demographics=demo, political_party=party)

    return DataResponse(response_fips=out)

# ----- Local dev ------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=12000, reload=True)
