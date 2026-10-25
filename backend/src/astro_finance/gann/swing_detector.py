"""
Swing High/Low Detector

Identifies significant turning points in price action for:
- Gann Fan origins
- Support/resistance levels
- Trend change signals

Uses multiple methods:
- Fractal patterns (Williams)
- Zigzag indicator
- Local extrema with minimum swing size
"""

import numpy as np
import pandas as pd
from typing import List, Tuple, Optional
from dataclasses import dataclass
from enum import Enum


class SwingType(Enum):
    HIGH = "high"
    LOW = "low"


@dataclass
class SwingPoint:
    """Represents a swing high or low point."""
    date: pd.Timestamp
    price: float
    swing_type: SwingType
    index: int  # position in dataframe
    
class SwingDetector:
    """Detects swing highs and lows in price data."""
    
    def __init__(self, method: str = 'fractal', min_swing_percent: float = 2.0):
        """
        Initialize swing detector.
        
        Args:
            method: Detection method ('fractal', 'zigzag', 'local_extrema')
            min_swing_percent: Minimum price change % to qualify as swing
        """
        self.method = method
        self.min_swing_percent = min_swing_percent
    
    def detect_fractals(self, df: pd.DataFrame, period: int = 2) -> pd.DataFrame:
        """
        Detect fractal swing points (Williams Fractals).
        
        A fractal high is when the middle candle has the highest high
        surrounded by 'period' lower highs on each side.
        """
        df_swing = df.copy()
        df_swing['Swing_High'] = 0
        df_swing['Swing_Low'] = 0
        
        for i in range(period, len(df) - period):
            # Check for swing high
            middle_high = df.iloc[i]['High']
            is_swing_high = True
            
            for j in range(1, period + 1):
                if (df.iloc[i - j]['High'] >= middle_high or 
                    df.iloc[i + j]['High'] >= middle_high):
                    is_swing_high = False
                    break
            
            if is_swing_high:
                df_swing.iloc[i, df_swing.columns.get_loc('Swing_High')] = middle_high
            
            # Check for swing low
            middle_low = df.iloc[i]['Low']
            is_swing_low = True
            
            for j in range(1, period + 1):
                if (df.iloc[i - j]['Low'] <= middle_low or 
                    df.iloc[i + j]['Low'] <= middle_low):
                    is_swing_low = False
                    break
            
            if is_swing_low:
                df_swing.iloc[i, df_swing.columns.get_loc('Swing_Low')] = middle_low
        
        return df_swing
    
    def detect_zigzag(
        self, 
        df: pd.DataFrame, 
        threshold_percent: Optional[float] = None
    ) -> List[SwingPoint]:
        """
        Detect swing points using zigzag algorithm.
        
        The zigzag connects swing highs and lows that differ by at least
        the threshold percentage.
        """
        if threshold_percent is None:
            threshold_percent = self.min_swing_percent
        
        threshold = threshold_percent / 100.0
        
        swings = []
        current_trend = None  # 'up' or 'down'
        last_swing_price = df.iloc[0]['Close']
        last_swing_idx = 0
        last_swing_date = df.index[0]
        
        for i in range(1, len(df)):
            price = df.iloc[i]['Close']
            date = df.index[i]
            
            if current_trend is None:
                # Initialize trend
                if price > last_swing_price * (1 + threshold):
                    current_trend = 'up'
                    swings.append(SwingPoint(
                        date=last_swing_date,
                        price=last_swing_price,
                        swing_type=SwingType.LOW,
                        index=last_swing_idx
                    ))
                elif price < last_swing_price * (1 - threshold):
                    current_trend = 'down'
                    swings.append(SwingPoint(
                        date=last_swing_date,
                        price=last_swing_price,
                        swing_type=SwingType.HIGH,
                        index=last_swing_idx
                    ))
            
            elif current_trend == 'up':
                # Look for swing high
                if price > last_swing_price:
                    # Update current swing high
                    last_swing_price = price
                    last_swing_idx = i
                    last_swing_date = date
                elif price < last_swing_price * (1 - threshold):
                    # Trend reversed - record swing high
                    swings.append(SwingPoint(
                        date=last_swing_date,
                        price=last_swing_price,
                        swing_type=SwingType.HIGH,
                        index=last_swing_idx
                    ))
                    current_trend = 'down'
                    last_swing_price = price
                    last_swing_idx = i
                    last_swing_date = date
            
            else:  # current_trend == 'down'
                # Look for swing low
                if price < last_swing_price:
                    # Update current swing low
                    last_swing_price = price
                    last_swing_idx = i
                    last_swing_date = date
                elif price > last_swing_price * (1 + threshold):
                    # Trend reversed - record swing low
                    swings.append(SwingPoint(
                        date=last_swing_date,
                        price=last_swing_price,
                        swing_type=SwingType.LOW,
                        index=last_swing_idx
                    ))
                    current_trend = 'up'
                    last_swing_price = price
                    last_swing_idx = i
                    last_swing_date = date
        
        return swings
    
    def detect_local_extrema(
        self, 
        df: pd.DataFrame, 
        window: int = 5
    ) -> List[SwingPoint]:
        """
        Detect local extrema (rolling window max/min).
        
        A point is a swing high if it's the maximum in a window,
        and a swing low if it's the minimum.
        """
        swings = []
        
        # Calculate rolling max/min
        df_temp = df.copy()
        df_temp['Rolling_Max'] = df_temp['High'].rolling(window=window, center=True).max()
        df_temp['Rolling_Min'] = df_temp['Low'].rolling(window=window, center=True).min()
        
        for i in range(window, len(df) - window):
            # Swing high
            if df_temp.iloc[i]['High'] == df_temp.iloc[i]['Rolling_Max']:
                swings.append(SwingPoint(
                    date=df_temp.index[i],
                    price=df_temp.iloc[i]['High'],
                    swing_type=SwingType.HIGH,
                    index=i
                ))
            
            # Swing low
            if df_temp.iloc[i]['Low'] == df_temp.iloc[i]['Rolling_Min']:
                swings.append(SwingPoint(
                    date=df_temp.index[i],
                    price=df_temp.iloc[i]['Low'],
                    swing_type=SwingType.LOW,
                    index=i
                ))
        
        # Remove duplicates and sort
        swings = self._remove_duplicate_swings(swings)
        
        return swings
    
    def detect(self, df: pd.DataFrame) -> List[SwingPoint]:
        """
        Detect swing points using the configured method.
        
        Args:
            df: DataFrame with OHLC data
            
        Returns:
            List of SwingPoint objects
        """
        if self.method == 'fractal':
            df_fractals = self.detect_fractals(df)
            swings = self._fractals_to_swingpoints(df_fractals)
        elif self.method == 'zigzag':
            swings = self.detect_zigzag(df)
        elif self.method == 'local_extrema':
            swings = self.detect_local_extrema(df)
        else:
            raise ValueError(f"Unknown method: {self.method}")
        
        return swings
    
    def _fractals_to_swingpoints(self, df_fractals: pd.DataFrame) -> List[SwingPoint]:
        """Convert fractal DataFrame to SwingPoint objects."""
        swings = []
        
        for i, row in df_fractals.iterrows():
            if row['Swing_High'] > 0:
                swings.append(SwingPoint(
                    date=i,
                    price=row['Swing_High'],
                    swing_type=SwingType.HIGH,
                    index=df_fractals.index.get_loc(i)
                ))
            
            if row['Swing_Low'] > 0:
                swings.append(SwingPoint(
                    date=i,
                    price=row['Swing_Low'],
                    swing_type=SwingType.LOW,
                    index=df_fractals.index.get_loc(i)
                ))
        
        return sorted(swings, key=lambda x: x.date)
    
    def _remove_duplicate_swings(self, swings: List[SwingPoint]) -> List[SwingPoint]:
        """
        Remove duplicate swing points that are too close together.
        Keep only the most extreme point in a cluster.
        """
        if not swings:
            return []
        
        cleaned = []
        i = 0
        
        while i < len(swings):
            current = swings[i]
            
            # Look ahead for similar swings within a small window
            j = i + 1
            cluster = [current]
            
            while j < len(swings) and (swings[j].index - current.index) < 5:
                if swings[j].swing_type == current.swing_type:
                    cluster.append(swings[j])
                j += 1
            
            # Keep only the most extreme in cluster
            if current.swing_type == SwingType.HIGH:
                best = max(cluster, key=lambda x: x.price)
            else:
                best = min(cluster, key=lambda x: x.price)
            
            cleaned.append(best)
            i = j if j > i + 1 else i + 1
        
        return cleaned
    
    def get_most_recent_swings(
        self, 
        swings: List[SwingPoint], 
        n: int = 5
    ) -> List[SwingPoint]:
        """Get the N most recent swing points."""
        return sorted(swings, key=lambda x: x.date, reverse=True)[:n]
    
    def get_major_swings(
        self, 
        swings: List[SwingPoint], 
        threshold_percent: float = 5.0
    ) -> List[SwingPoint]:
        """
        Filter to only major swings (large price movements).
        
        Args:
            swings: List of all swing points
            threshold_percent: Minimum % move to qualify as major
            
        Returns:
            Filtered list of major swings
        """
        if not swings:
            return []
        
        major_swings = []
        last_price = swings[0].price
        
        for swing in swings:
            pct_change = abs((swing.price - last_price) / last_price * 100)
            
            if pct_change >= threshold_percent:
                major_swings.append(swing)
                last_price = swing.price
        
        return major_swings
