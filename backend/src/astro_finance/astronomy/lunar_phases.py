"""
Lunar Phase Calculator

Calculates lunar phases and their influence on market sentiment.
Studies have shown correlations between lunar cycles and market volatility.

Key phases:
- New Moon: Fresh starts, increased volatility
- First Quarter: Building momentum
- Full Moon: Peak energy, highest volatility
- Last Quarter: Waning energy

Applications:
- Volatility prediction
- Sentiment indicators
- Cycle timing
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
from enum import Enum


class MoonPhase(Enum):
    """Lunar phase classifications."""
    NEW_MOON = "New Moon"
    WAXING_CRESCENT = "Waxing Crescent"
    FIRST_QUARTER = "First Quarter"
    WAXING_GIBBOUS = "Waxing Gibbous"
    FULL_MOON = "Full Moon"
    WANING_GIBBOUS = "Waning Gibbous"
    LAST_QUARTER = "Last Quarter"
    WANING_CRESCENT = "Waning Crescent"


class LunarPhaseCalculator:
    """
    Calculate lunar phases and market sentiment indicators.
    
    Uses astronomical calculations to determine moon phase
    and correlates with market volatility patterns.
    """
    
    # Lunar cycle length in days
    LUNAR_CYCLE = 29.53058867
    
    # Reference New Moon (J2000 epoch)
    REFERENCE_NEW_MOON_JD = 2451550.1  # Jan 6, 2000
    
    def __init__(self):
        self.use_swisseph = False
        try:
            import swisseph as swe
            self.swe = swe
            self.use_swisseph = True
        except ImportError:
            # Fallback to approximation
            pass
    
    def datetime_to_julian(self, dt: datetime) -> float:
        """Convert datetime to Julian Date."""
        a = (14 - dt.month) // 12
        y = dt.year + 4800 - a
        m = dt.month + 12 * a - 3
        
        jd = dt.day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
        
        # Add time fraction
        jd += (dt.hour - 12) / 24.0 + dt.minute / 1440.0 + dt.second / 86400.0
        
        return float(jd)
    
    def get_moon_illumination(self, date: datetime) -> float:
        """
        Calculate moon illumination percentage (0-100).
        
        0% = New Moon
        100% = Full Moon
        """
        if self.use_swisseph:
            # Use Swiss Ephemeris for precision
            jd = self.datetime_to_julian(date)
            
            # Get Sun and Moon positions
            sun_pos = self.swe.calc_ut(jd, self.swe.SUN)[0]
            moon_pos = self.swe.calc_ut(jd, self.swe.MOON)[0]
            
            # Calculate elongation (angle between Sun and Moon)
            elongation = (moon_pos[0] - sun_pos[0]) % 360
            
            # Illumination formula
            illumination = (1 - np.cos(np.radians(elongation))) / 2 * 100
            
            return illumination
        else:
            # Fallback approximation
            jd = self.datetime_to_julian(date)
            days_since_ref = jd - self.REFERENCE_NEW_MOON_JD
            phase_in_cycle = (days_since_ref % self.LUNAR_CYCLE) / self.LUNAR_CYCLE
            
            # Approximate illumination
            illumination = (1 - np.cos(2 * np.pi * phase_in_cycle)) / 2 * 100
            
            return illumination
    
    def get_moon_phase(self, date: datetime) -> MoonPhase:
        """Determine the current moon phase."""
        illumination = self.get_moon_illumination(date)
        
        if illumination < 6.25:
            return MoonPhase.NEW_MOON
        elif illumination < 31.25:
            return MoonPhase.WAXING_CRESCENT
        elif illumination < 43.75:
            return MoonPhase.FIRST_QUARTER
        elif illumination < 68.75:
            return MoonPhase.WAXING_GIBBOUS
        elif illumination < 81.25:
            return MoonPhase.FULL_MOON
        elif illumination < 93.75:
            return MoonPhase.WANING_GIBBOUS
        elif illumination < 106.25:
            return MoonPhase.LAST_QUARTER
        else:
            return MoonPhase.WANING_CRESCENT
    
    def calculate_lunar_sentiment(self, date: datetime) -> Dict[str, float]:
        """
        Calculate market sentiment indicators based on lunar phase.
        
        Returns:
            Dictionary with sentiment scores:
            - volatility_index: Expected volatility (0-1)
            - bullish_bias: Bullish tendency (0-1)
            - energy_level: Market energy (0-1)
        """
        illumination = self.get_moon_illumination(date)
        phase = self.get_moon_phase(date)
        
        # Volatility peaks at New and Full Moon
        # Create a sine wave pattern: high at 0% and 100%, low at 50%
        volatility = abs(np.sin(np.radians(illumination * 3.6))) * 0.7 + 0.3
        
        # Bullish bias increases from New to Full Moon
        bullish_bias = illumination / 100.0
        
        # Energy level peaks at Full Moon
        energy = 1 - abs(0.5 - (illumination / 100.0)) * 2
        
        return {
            'illumination': illumination,
            'phase': phase.value,
            'volatility_index': round(volatility, 3),
            'bullish_bias': round(bullish_bias, 3),
            'energy_level': round(energy, 3)
        }
    
    def find_next_phase_change(
        self, 
        start_date: datetime, 
        target_phase: MoonPhase,
        max_days: int = 60
    ) -> Tuple[datetime, float]:
        """
        Find the next occurrence of a specific moon phase.
        
        Returns:
            (date_of_phase, illumination_percentage)
        """
        current_date = start_date
        current_phase = self.get_moon_phase(current_date)
        
        for _ in range(max_days):
            current_date += timedelta(days=1)
            current_phase = self.get_moon_phase(current_date)
            
            if current_phase == target_phase:
                illumination = self.get_moon_illumination(current_date)
                return (current_date, illumination)
        
        # Not found within max_days
        return (None, 0.0)
    
    def get_lunar_calendar(
        self, 
        start_date: datetime, 
        end_date: datetime
    ) -> pd.DataFrame:
        """
        Generate a lunar calendar for a date range.
        
        Returns DataFrame with daily lunar data.
        """
        date_range = pd.date_range(start=start_date, end=end_date, freq='D')
        
        data = []
        for date in date_range:
            sentiment = self.calculate_lunar_sentiment(date.to_pydatetime())
            data.append({
                'Date': date,
                **sentiment
            })
        
        return pd.DataFrame(data).set_index('Date')
    
    def detect_lunar_events(
        self, 
        df: pd.DataFrame,
        event_type: str = 'full_moon'
    ) -> List[datetime]:
        """
        Detect specific lunar events (New Moon, Full Moon, eclipses).
        
        Args:
            df: DataFrame with DatetimeIndex
            event_type: 'new_moon', 'full_moon', 'first_quarter', 'last_quarter'
            
        Returns:
            List of dates where events occur
        """
        events = []
        prev_illumination = None
        
        for date in df.index:
            illumination = self.get_moon_illumination(date.to_pydatetime())
            
            if prev_illumination is not None:
                if event_type == 'new_moon':
                    # Detect minimum (local min around 0%)
                    if prev_illumination > illumination and illumination < 5:
                        events.append(date)
                
                elif event_type == 'full_moon':
                    # Detect maximum (local max around 100%)
                    if prev_illumination < illumination and illumination > 95:
                        events.append(date)
                
                elif event_type == 'first_quarter':
                    # Crossing 50% ascending
                    if prev_illumination < 50 < illumination:
                        events.append(date)
                
                elif event_type == 'last_quarter':
                    # Crossing 50% descending
                    if prev_illumination > 50 > illumination:
                        events.append(date)
            
            prev_illumination = illumination
        
        return events
