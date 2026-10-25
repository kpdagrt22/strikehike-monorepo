"""
Retrograde Detector

Detects planetary retrogrades - periods when planets appear to move backward
from Earth's perspective. These periods are significant in financial astrology:

Mercury Retrograde: Communication breakdowns, technical issues, market hesitation
Venus Retrograde: Value reassessment, relationship changes
Mars Retrograde: Energy shifts, aggression patterns
Jupiter/Saturn Retrograde: Macro trend reversals
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
from dataclasses import dataclass


@dataclass
class RetrogradePeriod:
    """Represents a retrograde period for a planet."""
    planet: str
    start_date: datetime
    end_date: datetime
    duration_days: int
    entry_degree: float  #Degree at retrograde station
    exit_degree: float  # Degree at direct station


class RetrogradeDetector:
    """
    Detect planetary retrograde periods using position differentials.
    
    A planet is retrograde when its apparent geocentric ecliptic longitude
    decreases over time (moving backward through the zodiac).
    """
    
    # Typical retrograde frequencies (approximate)
    RETROGRADE_INFO = {
        'Mercury': {'frequency_days': 88, 'duration_days': 24},
        'Venus': {'frequency_days': 584, 'duration_days': 42},
        'Mars': {'frequency_days': 780, 'duration_days': 72},
        'Jupiter': {'frequency_days': 398, 'duration_days': 121},
        'Saturn': {'frequency_days': 378, 'duration_days': 138},
        'Uranus': {'frequency_days': 369, 'duration_days': 151},
        'Neptune': {'frequency_days': 367, 'duration_days': 158},
        'Pluto': {'frequency_days': 366, 'duration_days': 160}
    }
    
    def __init__(self):
        self.use_swisseph = False
        try:
            import swisseph as swe
            self.swe = swe
            self.use_swisseph = True
        except ImportError:
            pass
    
    def detect_retrograde_simple(
        self, 
        positions: np.ndarray,
        smoothing_window: int = 3
    ) -> np.ndarray:
        """
        Detect retrograde motion from position array.
        
        Args:
            positions: Array of planetary positions (degrees)
            smoothing_window: Window for smoothing to avoid false signals
            
        Returns:
            Boolean array where True = retrograde
        """
        # Calculate daily motion
        diff = np.diff(positions, prepend=positions[0])
        
        # Handle zodiac wraparound (360 -> 0 transition)
        diff = np.where(diff < -300, diff + 360, diff)
        diff = np.where(diff > 300, diff - 360, diff)
        
        # Smooth to avoid noise
        if smoothing_window > 1:
            diff_smoothed = pd.Series(diff).rolling(
                window=smoothing_window, center=True
            ).mean().fillna(method='bfill').fillna(method='ffill').values
        else:
            diff_smoothed = diff
        
        # Retrograde when motion is negative
        is_retrograde = diff_smoothed < 0
        
        return is_retrograde.astype(int)
    
    def detect_retrograde_periods(
        self,
        df: pd.DataFrame,
        planet: str
    ) -> List[RetrogradePeriod]:
        """
        Detect discrete retrograde periods with start/end dates.
        
        Args:
            df: DataFrame with planetary position columns
            planet: Planet name (e.g., 'Mercury')
            
        Returns:
            List of RetrogradePeriod objects
        """
        position_col = f'{planet}_Degree'
        retrograde_col = f'{planet}_Retrograde'
        
        if position_col not in df.columns:
            raise ValueError(f"Column {position_col} not found in DataFrame")
        
        # Get retrograde boolean array
        if retrograde_col in df.columns:
            is_retrograde = df[retrograde_col].values
        else:
            is_retrograde = self.detect_retrograde_simple(df[position_col].values)
        
        # Find periods (consecutive True values)
        periods = []
        in_retrograde = False
        start_date = None
        start_degree = None
        
        for i, (date, row) in enumerate(df.iterrows()):
            if is_retrograde[i] and not in_retrograde:
                # Entering retrograde
                in_retrograde = True
                start_date = date
                start_degree = row[position_col]
            
            elif not is_retrograde[i] and in_retrograde:
                # Exiting retrograde
                in_retrograde = False
                end_date = date
                end_degree = row[position_col]
                duration = (end_date - start_date).days
                
                periods.append(RetrogradePeriod(
                    planet=planet,
                    start_date=start_date,
                    end_date=end_date,
                    duration_days=duration,
                    entry_degree=start_degree,
                    exit_degree=end_degree
                ))
        
        return periods
    
    def is_planet_retrograde(
        self,
        date: datetime,
        planet: str
    ) -> bool:
        """
        Check if a specific planet is retrograde on a given date.
        Requires Swiss Ephemeris for real-time checking.
        """
        if not self.use_swisseph:
            raise NotImplementedError("Swiss Ephemeris required for point-in-time checks")
        
        # Convert datetime to Julian Date
        jd = self._datetime_to_julian(date)
        
        # Get planet ID
        planet_ids = {
            'Sun': self.swe.SUN,
            'Moon': self.swe.MOON,
            'Mercury': self.swe.MERCURY,
            'Venus': self.swe.VENUS,
            'Mars': self.swe.MARS,
            'Jupiter': self.swe.JUPITER,
            'Saturn': self.swe.SATURN,
            'Uranus': self.swe.URANUS,
            'Neptune': self.swe.NEPTUNE,
            'Pluto': self.swe.PLUTO
        }
        
        if planet not in planet_ids:
            raise ValueError(f"Unknown planet: {planet}")
        
        # Calculate position and speed
        result = self.swe.calc_ut(jd, planet_ids[planet])
        longitude_speed = result[0][3]  # Speed in degrees per day
        
        # Retrograde if speed is negative
        return longitude_speed < 0
    
    def get_retrograde_volatility_score(
        self,
        periods: List[RetrogradePeriod],
        current_date: datetime,
        lookback_days: int = 30
    ) -> Dict[str, float]:
        """
        Calculate volatility score based on retrograde activity.
        
        More retrogrades = higher volatility expectation
        Mercury retrograde has highest impact
        """
        scores = {
            'Mercury': 0.4,
            'Venus': 0.15,
            'Mars': 0.25,
            'Jupiter': 0.1,
            'Saturn': 0.1
        }
        
        total_score = 0.0
        active_retrogrades = []
        
        for period in periods:
            # Check if period overlaps with current date window
            window_start = current_date - timedelta(days=lookback_days)
            window_end = current_date
            
            if (period.start_date <= window_end and 
                period.end_date >= window_start):
                
                # Period is active or recent
                planet_score = scores.get(period.planet, 0.05)
                
                # Higher score if currently active
                if period.start_date <= current_date <= period.end_date:
                    total_score += planet_score
                    active_retrogrades.append(period.planet)
                else:
                    # Recent but not active - reduced impact
                    total_score += planet_score * 0.3
        
        return {
            'volatility_score': min(total_score, 1.0),
            'active_retrogrades': active_retrogrades,
            'num_active': len(active_retrogrades)
        }
    
    def _datetime_to_julian(self, dt: datetime) -> float:
        """Convert datetime to Julian Date."""
        a = (14 - dt.month) // 12
        y = dt.year + 4800 - a
        m = dt.month + 12 * a - 3
        
        jd = dt.day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045
        jd += (dt.hour - 12) / 24.0 + dt.minute / 1440.0 + dt.second / 86400.0
        
        return float(jd)
    
    def add_retrograde_features(
        self,
        df: pd.DataFrame,
        planets: List[str] = None
    ) -> pd.DataFrame:
        """
        Add retrograde-related features to a DataFrame for ML.
        
        Features:
        - Individual planet retrograde flags
        - Total retrograde count
        - Retrograde volatility score
        - Days since Mercury retrograde
        """
        if planets is None:
            planets = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']
        
        df_enhanced = df.copy()
        
        all_periods = []
        for planet in planets:
            try:
                periods = self.detect_retrograde_periods(df, planet)
                all_periods.extend(periods)
                
                # Add binary flag
                df_enhanced[f'{planet}_Retrograde_Flag'] = 0
                for period in periods:
                    mask = (df_enhanced.index >= period.start_date) & \
                           (df_enhanced.index <= period.end_date)
                    df_enhanced.loc[mask, f'{planet}_Retrograde_Flag'] = 1
                    
            except ValueError:
                # Planet not in dataframe
                continue
        
        # Total retrograde count
        retrograde_cols = [col for col in df_enhanced.columns if col.endswith('_Retrograde_Flag')]
        df_enhanced['Total_Retrogrades'] = df_enhanced[retrograde_cols].sum(axis=1)
        
        # Volatility score (calculated per row)
        volatility_scores = []
        for date in df_enhanced.index:
            score_data = self.get_retrograde_volatility_score(
                all_periods, date.to_pydatetime(), lookback_days=30
            )
            volatility_scores.append(score_data['volatility_score'])
        
        df_enhanced['Retrograde_Volatility'] = volatility_scores
        
        return df_enhanced
