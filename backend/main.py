from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tax_config import get_reliefs
from calculations import calculate_assessment
from schemas import (
    CalculateRequest,
    CalculateResponse,
    ReliefCatalogueResponse,
)

app = FastAPI(title="CukaiCopilot API")

app.add_middleware(
    CORSMiddleware,
    # Vite's default dev port (5173) plus a couple of fallbacks it auto-picks
    # when 5173 is taken, so the frontend can reach the API in any of them.
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5188",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# To test frontend-backend API connection
@app.get("/test")
async def test_api():
    return "Hello World!"


@app.get("/api/v1/tax/reliefs", response_model=ReliefCatalogueResponse)
async def list_reliefs(ya: int = 2025):
    """Active relief categories and their caps for a Year of Assessment.

    Used by the frontend to build the calculator form dynamically, so adding a
    relief in tax_config.py automatically adds a field on the UI.
    """
    return {"year_of_assessment": ya, "reliefs": get_reliefs(ya)}


@app.post("/api/v1/tax/calculate", response_model=CalculateResponse)
async def calculate_tax(payload: CalculateRequest):
    """Calculate chargeable income, tax payable, and relief savings.

    Caps each relief at its legal maximum, derives chargeable income, applies
    the progressive brackets and rebates, and reports how much the reliefs saved.
    """
    return calculate_assessment(
        total_income=payload.total_income,
        reliefs=payload.reliefs,
        zakat=payload.zakat,
        ya=payload.year_of_assessment,
    )
