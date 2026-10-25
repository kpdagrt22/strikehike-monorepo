"""
Gann Angle Calculator

Implements W.D. Gann's angular price-time relationships:
- 1x1: 45-degree angle (1 unit price per 1 unit time)
- 2x1: 2 units price per 1 unit time (steeper bullish)
- 1x2: 1 unit price per 2 units time (gentler bullish)
- etc.

Gann angles act as dynamic support/resistance levels based on geometric harmonics.
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class GannAngle:
    """Represents a single Gann angle line."""
    ratio: str  # e.g., "1x1", "2x1"
    slope: float  # actual slope value
    origin_date: pd.Timestamp
    origin_price: float
    angle_type: str  # 'bullish' or 'bearish'
    
    def price_at_date(self, target_date: pd.Timestamp, time_unit_days: int = 1) -> float:
        """Calculate price at a given date along this Gann angle."""
        days_elapsed = (target_date - self.origin_date).days
        time_units = days_elapsed / time_unit_days
        
        if self.angle_type == 'bullish':
            return self.origin_price + (self.slope * time_units)
        else:  # bearish
            return self.origin_price - (self.slope * time_units)


class GannAngleCalculator:
    """
    Calculates Gann Angles from swing points.
    
    The key insight is that price and time are geometric equals in Gann's theory.
    The challenge is determining the "scaling" - what price change equals one day?
    
    Common approaches:
    1. Use price range / time range from a significant swing
    2. Use ATR (Average True Range) as the scaling factor
    3. Use a percentage of price (e.g., 1% = 1 day)
    """
    
    # Standard Gann angle ratios
    ANGLE_RATIOS = {
        '8x1': 8.0,    # Very steep
        '4x1': 4.0,
        '3x1': 3.0,
        '2x1': 2.0,
        '1x1': 1.0,    # 45 degrees - most important
        '1x2': 0.5,
        '1x3': 0.333,
        '1x4': 0.25,
        '1x8': 0.125   # Very gentle
    }
    
    def __init__(self, scaling_method: str = 'atr'):
        """
        Initialize Gann calculator.
        
        Args:
            scaling_method: Method to determine price/time scaling
                - 'atr': Use Average True Range
                - 'percent': Use 1% of price = 1 day
                - 'range': Use swing range
        """
        self.scaling_method = scaling_method
    
    def calculate_scaling_factor(
        self, 
        df: pd.DataFrame, 
        origin_price: float,
        window: int = 20
    ) -> float:
        """
        Calculate the price/time scaling factor.
        
        Returns: price units per time unit (day)
        """
        if self.scaling_method == 'atr':
            # Use ATR as scaling: 1 ATR = 1 day of movement
            if 'High' in df.columns and 'Low' in df.columns:
                df_temp = df.tail(window).copy()
                df_temp['H-L'] = df_temp['High'] - df_temp['Low']
                df_temp['H-PC'] = abs(df_temp['High'] - df_temp['Close'].shift(1))
                df_temp['L-PC'] = abs(df_temp['Low'] - df_temp['Close'].shift(1))
                df_temp['TR'] = df_temp[['H-L', 'H-PC', 'L-PC']].max(axis=1)
                atr = df_temp['TR'].mean()
                return atr
            else:
                # Fallback to simple volatility
                returns = df['Close'].pct_change().tail(window)
                return abs(returns.std() * origin_price)
        
        elif self.scaling_method == 'percent':
            # 1% of price = 1 day
            return origin_price * 0.01
        
        elif self.scaling_method == 'range':
            # Use recent price range
            recent_high = df['Close'].tail(window).max()
            recent_low = df['Close'].tail(window).min()
            return (recent_high - recent_low) / window
        
        return origin_price * 0.01  # Default fallback
    
    def calculate_angles_from_point(
        self,
        origin_date: pd.Timestamp,
        origin_price: float,
        df: pd.DataFrame,
        angle_type: str = 'bullish',
        scaling_window: int = 20
    ) -> Dict[str, GannAngle]:
        """
        Calculate all Gann angles from a swing point.
        
        Args:
            origin_date: Starting date (swing high/low)
            origin_price: Starting price
            df: Historical price dataframe (for scaling calculation)
            angle_type: 'bullish' (from low) or 'bearish' (from high)
            scaling_window: Window for calculating scaling factor
            
        Returns:
            Dictionary of GannAngle objects keyed by ratio name
        """
        # Calculate price/time scaling
        scaling_factor = self.calculate_scaling_factor(df, origin_price, scaling_window)
        
        angles = {}
        for ratio_name, ratio_value in self.ANGLE_RATIOS.items():
            slope = scaling_factor *ratio_value
            angles[ratio_name] = GannAngle(
                ratio=ratio_name,
                slope=slope,
                origin_date=origin_date,
                origin_price=origin_price,
                angle_type=angle_type
            )
        
        return angles
    
    def get_gann_fan_levels(
        self,
        origin_date: pd.Timestamp,
        origin_price: float,
        df: pd.DataFrame,
        future_dates: pd.DatetimeIndex,
        angle_type: str = 'bullish'
    ) -> pd.DataFrame:
        """
        Generate Gann Fan levels for plotting.
        
        Returns a DataFrame with columns for each Gann angle ratio,
        indexed by date, containing the price levels.
        """
        angles = self.calculate_angles_from_point(
            origin_date, origin_price, df, angle_type
        )
        
        # Calculate price for each angle at each future date
        results = {'Date': future_dates}
        
        for ratio_name, angle in angles.items():
            prices = [angle.price_at_date(date) for date in future_dates]
            results[f'Gann_{ratio_name}'] = prices
        
        return pd.DataFrame(results).set_index('Date')
    
    def check_angle_support_resistance(
        self,
        df: pd.DataFrame,
        angles: Dict[str, GannAngle],
        tolerance_percent: float = 0.5
    ) -> pd.DataFrame:
        """
        Check which Gann angles are acting as support/resistance.
        
        Returns a DataFrame with boolean columns indicating if price
        is near each Gann angle (within tolerance).
        """
        results = df[['Close']].copy()
        
        for ratio_name, angle in angles.items():
            # Calculate theoretical price at each date
            theoretical_prices = []
            for date in df.index:
                if date >= angle.origin_date:
                    theoretical_prices.append(angle.price_at_date(date))
                else:
                    theoretical_prices.append(np.nan)
            
            results[f'{ratio_name}_level'] = theoretical_prices
            
            # Check if actual price is within tolerance
            tolerance = results['Close'] * (tolerance_percent / 100)
            diff = abs(results['Close'] - results[f'{ratio_name}_level'])
            results[f'{ratio_name}_touch'] = (diff <= tolerance).astype(int)
        
        return results
    
    def find_gann_angle_strength(
        self,
        current_price: float,
        current_date: pd.Timestamp,
        angles: Dict[str, GannAngle]
    ) -> Dict[str, str]:
        """
        Determine which Gann angle the price is currently above/below.
        
        This helps identify trend strength:
        - Price above 1x1: Strong bullish
        - Price between 1x1 and 1x2: Moderate bullish
        - Price below 1x1: Bearish on this fan
        
        Returns:
            Dictionary with strength indicators
        """
        angle_positions = {}
        
        for ratio_name, angle in angles.items():
            theo_price = angle.price_at_date(current_date)
            
            if current_price > theo_price:
                angle_positions[ratio_name] = 'above'
            elif current_price < theo_price:
                angle_positions[ratio_name] = 'below'
            else:
                angle_positions[ratio_name] = 'on'
        
        # Determine overall strength
        if angle_positions.get('1x1') == 'above':
            strength = 'strong_bullish'
        elif angle_positions.get('1x1') == 'below':
            strength = 'weak_bearish'
        else:
            strength = 'neutral'
        
        return {
            'strength': strength,
            'angle_positions': angle_positions
        }
