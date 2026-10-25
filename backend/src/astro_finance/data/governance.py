from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional

class PlanetaryRow(BaseModel):
    """Schema for a single row of planetary position data."""
    date: datetime = Field(..., description="Date of the observation")
    # Dynamic fields for planets would be handled by a more complex schema or validation logic
    # Here we define the expected structure for processed rows
    
    sun_degree: Optional[float] = Field(None, ge=0, le=360, alias="Sun_Degree")
    moon_degree: Optional[float] = Field(None, ge=0, le=360, alias="Moon_Degree")
    # Add generic validation or allow extra fields
    
    class Config:
        extra = "allow" # Allow other planets

    @field_validator('date')
    @classmethod
    def check_date_range(cls, v):
        if v.year < 1800 or v.year > 2200:
            raise ValueError('Date out of expected range')
        return v

class MarketRow(BaseModel):
    """Schema for a single row of stock market data."""
    date: datetime
    close: float = Field(..., gt=0, description="Closing price")
    ticker: str = Field(..., min_length=1)
    
    class Config:
        extra = "allow"
