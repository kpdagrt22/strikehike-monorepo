"""
Gann Theory Microservice - Enterprise Grade

Provides Gann calculations (angles, Square of 9, swing detection)
with caching, monitoring, and production-ready error handling.
"""

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import structlog
import redis
import json
import os

# Import Gann modules
from src.astro_finance.gann.angles import GannAngleCalculator
from src.astro_finance.gann.square_of_nine import SquareOfNineCalculator
from src.astro_finance.gann.swing_detector import SwingDetector

logger = structlog.get_logger()

app = FastAPI(
    title="Gann Service",
    version="1.0.0",
    description="Gann Theory calculations and analysis"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

Instrumentator().instrument(app).expose(app)

# Redis
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=1,  # Different DB from prediction service
    decode_responses=True
)

# Request/Response Models
class GannFanRequest(BaseModel):
    ticker: str = Field(..., description="Trading symbol")
    origin_date: str = Field(..., description="Swing point date (YYYY-MM-DD)")
    origin_price: float = Field(..., gt=0, description="Swing point price")
    angle_type: str = Field(..., description="bullish or bearish")
    days_forward: int = Field(50, ge=10, le=365, description="Days to project")
    
    @validator('angle_type')
    def validate_angle_type(cls, v):
        if v not in ['bullish', 'bearish']:
            raise ValueError("angle_type must be 'bullish' or 'bearish'")
        return v

class GannFanResponse(BaseModel):
    ticker: str
    origin_date: str
    origin_price: float
    angle_type: str
    fan_levels: Dict[str, List[Dict[str, float]]]
    timestamp: datetime
    cached: bool

class SquareOf9Request(BaseModel):
    price: float = Field(..., gt=0)
    num_levels: int = Field(5, ge=1, le=20)

class SquareOf9Response(BaseModel):
    base_price: float
    resistance_levels: List[float]
    support_levels: List[float]
    nearest_harmonic: float
    timestamp: datetime
    cached: bool

class SwingRequest(BaseModel):
    ticker: str
    method: str = Field("fractal", description="fractal, zigzag, or local_extrema")
    lookback: int = Field(10, ge=3, le=50)

class SwingPoint(BaseModel):
    date: str
    price: float
    type: str  # "high" or "low"

class SwingResponse(BaseModel):
    ticker: str
    method: str
    swing_points: List[SwingPoint]
    last_swing: SwingPoint
    timestamp: datetime

# Endpoints
@app.get("/health")
async def health_check():
    try:
        redis_client.ping()
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow(),
            "cache_available": True
        }
    except:
        return {
            "status": "degraded",
            "timestamp": datetime.utcnow(),
            "cache_available": False
        }

@app.post("/v1/gann/fan", response_model=GannFanResponse)
async def calculate_gann_fan(
    request: GannFanRequest,
    x_api_key: Optional[str] = Header(None)
):
    """Calculate Gann Fan levels"""
    start_time = datetime.utcnow()
    
    # Check cache
    cache_key = f"gann:fan:{request.ticker}:{request.origin_date}:{request.angle_type}"
    cached = redis_client.get(cache_key)
    if cached:
        logger.info("cache_hit", symbol=request.ticker)
        result = json.loads(cached)
        result["cached"] = True
        return GannFanResponse(**result)
    
    try:
        # Calculate Gann angles
        calculator = GannAngleCalculator()
        
        origin_data = {
            'date': pd.to_datetime(request.origin_date),
            'price': request.origin_price
        }
        
        angles = calculator.calculate_gann_fan(
            swing_point=origin_data,
            is_bullish=(request.angle_type == 'bullish'),
            bars_forward=request.days_forward
        )
        
        # Format response
        fan_levels = {}
        for angle_name, levels in angles.items():
            fan_levels[angle_name] = [
                {'price': float(price)} for price in levels
            ]
        
        response_data = {
            "ticker": request.ticker,
            "origin_date": request.origin_date,
            "origin_price": request.origin_price,
            "angle_type": request.angle_type,
            "fan_levels": fan_levels,
            "timestamp": datetime.utcnow(),
            "cached": False
        }
        
        # Cache for 1 hour
        redis_client.setex(cache_key, 3600, json.dumps(response_data, default=str))
        
        duration_ms = (datetime.utcnow() - start_time).total_seconds() * 1000
        logger.info("gann_fan_calculated", symbol=request.ticker, duration_ms=duration_ms)
        
        return GannFanResponse(**response_data)
    
    except Exception as e:
        logger.error("gann_fan_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/gann/square-of-9", response_model=SquareOf9Response)
async def calculate_square_of_9(
    request: SquareOf9Request,
    x_api_key: Optional[str] = Header(None)
):
    """Calculate Square of 9 support/resistance levels"""
    cache_key = f"sq9:{request.price}:{request.num_levels}"
    cached = redis_client.get(cache_key)
    if cached:
        result = json.loads(cached)
        result["cached"] = True
        return SquareOf9Response(**result)
    
    try:
        calculator = SquareOfNineCalculator()
        
        support, resistance = calculator.calculate_levels(
            price=request.price,
            num_levels=request.num_levels
        )
        
        harmonic = calculator.find_nearest_harmonic(request.price)
        
        response_data = {
            "base_price": request.price,
            "resistance_levels": [float(r) for r in resistance],
            "support_levels": [float(s) for s in support],
            "nearest_harmonic": float(harmonic),
            "timestamp": datetime.utcnow(),
            "cached": False
        }
        
        # Cache for 1 hour
        redis_client.setex(cache_key, 3600, json.dumps(response_data, default=str))
        
        logger.info("sq9_calculated", price=request.price)
        
        return SquareOf9Response(**response_data)
    
    except Exception as e:
        logger.error("sq9_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.on_event("startup")
async def startup_event():
    logger.info("service_starting", service="gann")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("service_stopping", service="gann")
    redis_client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
