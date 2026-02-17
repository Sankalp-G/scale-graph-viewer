from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.forecast_streaming import router as forecast_streaming_router
from .api.forecasting import router as forecasting_router
from .api.nowcasting import router as nowcasting_router
from .api.sample import router as sample_router

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sample_router)
app.include_router(forecasting_router)
app.include_router(forecast_streaming_router)
app.include_router(nowcasting_router)
