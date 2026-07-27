from fastapi import FastAPI, HTTPException

from .engine import solve
from .models import SolverRequest, SolverResult

app = FastAPI(title="EventClear Solver", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "solver"}


@app.post("/solve", response_model=SolverResult)
def solve_request(request: SolverRequest) -> SolverResult:
    result = solve(request)
    if not result.isSatisfiable:
        raise HTTPException(status_code=422, detail=result.model_dump(mode="json"))
    return result
