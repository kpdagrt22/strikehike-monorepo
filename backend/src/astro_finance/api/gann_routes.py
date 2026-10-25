"""
Gann Analysis API Endpoints

Extends the FastAPI server with Gann Theory analysis capabilities.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

from astro_finance.gann import GannAngleCalculator, SwingDetector, SquareOfNine
from astro_finance.astronomy import LunarPhaseCalculator

router = APIRouter(prefix="/api/v1/gann", tags=["gann"])

# Global instances
gann_calculator = GannAngleCalculator(scaling_method='atr')
swing_detector = SwingDetector(method='zigzag', min_swing_percent=2.0)
sq9 = SquareOfNine()
lunar = LunarPhaseCalculator()


class GannFanRequest(BaseModel):
    """Request model for Gann Fan analysis."""
    ticker: str
    origin_date: str  # ISO format
    origin_price: float
    angle_type: str = 'bullish'  # or 'bearish'
    days_forward: int = 90


class GannFanResponse(BaseModel):
    """Response with Gann Fan levels."""
    ticker: str
    origin_date: str
    origin_price: float
    angle_type: str
    fan_levels: Dict[str, List[Dict[str, float]]]  # ratio -> [{date, price}]


class SquareOf9Request(BaseModel):
    """Request for Square of 9 analysis."""
    price: float
    num_levels: int = 5


class SquareOf9Response(BaseModel):
    """Square of 9 price targets."""
    base_price: float
    resistance_levels: List[float]
    support_levels: List[float]
    nearest_harmonic: int


class LunarSentimentResponse(BaseModel):
    """Lunar phase sentiment data."""
    date: str
    illumination: float
    phase: str
    volatility_index: float
    bullish_bias: float
    energy_level: float
    next_new_moon: Optional[str]
    next_full_moon: Optional[str]


@router.post("/fan", response_model=GannFanResponse)
async def calculate_gann_fan(request: GannFanRequest):
    """
    Calculate Gann Fan levels from a swing point.
    
    Returns all standard Gann angles projected forward.
    """
    try:
        origin_date = pd.Timestamp(request.origin_date)
        
        # Create mock price data for scaling calculation
        # In production, fetch real historical data
        dates = pd.date_range(start=origin_date - timedelta(days=100), end=origin_date, freq='D')
        mock_df = pd.DataFrame({
            'Close': np.random.normal(request.origin_price, request.origin_price * 0.02, len(dates)),
            'High': np.random.normal(request.origin_price * 1.01, request.origin_price * 0.02, len(dates)),
            'Low': np.random.normal(request.origin_price * 0.99, request.origin_price * 0.02, len(dates))
        }, index=dates)
        
        # Calculate Gann angles
        angles = gann_calculator.calculate_angles_from_point(
            origin_date=origin_date,
            origin_price=request.origin_price,
            df=mock_df,
            angle_type=request.angle_type
        )
        
        # Generate future levels
        future_dates = pd.date_range(
            start=origin_date, 
            periods=request.days_forward, 
            freq='D'
        )
        
        fan_levels = {}
        for ratio_name, angle in angles.items():
            levels = []
            for date in future_dates:
                price = angle.price_at_date(date)
                levels.append({
                    'date': date.isoformat(),
                    'price': round(price, 2)
                })
            fan_levels[ratio_name] = levels
        
        return GannFanResponse(
            ticker=request.ticker,
            origin_date=request.origin_date,
            origin_price=request.origin_price,
            angle_type=request.angle_type,
            fan_levels=fan_levels
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gann Fan calculation failed: {str(e)}")


@router.post("/square-of-9", response_model=SquareOf9Response)
async def calculate_square_of_9(request: SquareOf9Request):
    """
    Calculate Square of 9 support and resistance levels.
    
    Returns harmonic price targets based on Gann's square relationships.
    """
    try:
        resistances = sq9.calculate_resistance_levels(
            base_price=request.price,
            num_levels=request.num_levels
        )
        
        supports = sq9.calculate_support_levels(
            base_price=request.price,
            num_levels=request.num_levels
        )
        
        nearest_harmonic = sq9.find_nearest_square_value(request.price)
        
        return SquareOf9Response(
            base_price=request.price,
            resistance_levels=[round(r, 2) for r in resistances],
            support_levels=[round(s, 2) for s in supports],
            nearest_harmonic=nearest_harmonic
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Square of 9 calculation failed: {str(e)}")


@router.get("/lunar-sentiment", response_model=LunarSentimentResponse)
async def get_lunar_sentiment(date: Optional[str] = None):
    """
    Get current lunar phase and market sentiment indicators.
    
    If no date provided, uses current date.
    """
    try:
        if date:
            target_date = datetime.fromisoformat(date)
        else:
            target_date = datetime.now()
        
        sentiment = lunar.calculate_lunar_sentiment(target_date)
        
        # Find next new and full moons
        from astro_finance.astronomy.lunar_phases import MoonPhase
        
        next_new = lunar.find_next_phase_change(target_date, MoonPhase.NEW_MOON)
        next_full = lunar.find_next_phase_change(target_date, MoonPhase.FULL_MOON)
        
        return LunarSentimentResponse(
            date=target_date.isoformat(),
            illumination=round(sentiment['illumination'], 2),
            phase=sentiment['phase'],
            volatility_index=sentiment['volatility_index'],
            bullish_bias=sentiment['bullish_bias'],
            energy_level=sentiment['energy_level'],
            next_new_moon=next_new[0].isoformat() if next_new[0] else None,
            next_full_moon=next_full[0].isoformat() if next_full[0] else None
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lunar sentiment calculation failed: {str(e)}")


# Include router in main app
def setup_gann_routes(app):
    """Add Gann routes to FastAPI app."""
    app.include_router(router)
