"""
Gann Feature Engineering

Adds Gann Theory features to the existing feature engineering pipeline.
Enhances predictions with geometric price-time analysis.
"""

import pandas as pd
import numpy as np
from typing import Dict, List
from loguru import logger
from astro_finance.gann import GannAngleCalculator, SwingDetector, SquareOfNine
from astro_finance.astronomy import LunarPhaseCalculator, RetrogradeDetector


class GannFeatureEngineer:
    """
    Integrates Gann Theory features into ML feature set.
    
    Features added:
    - Distance from key Gann angles (1x1, 2x1, etc.)
    - Gann trend strength indicator
    - Square of 9 harmonic proximity
    - Swing point proximity
    - Lunar phase sentiment scores
    - Retrograde volatility indicators
    """
    
    def __init__(self):
        self.gann_calculator = GannAngleCalculator(scaling_method='atr')
        self.swing_detector = SwingDetector(method='zigzag', min_swing_percent=2.0)
        self.sq9 = SquareOfNine()
        self.lunar = LunarPhaseCalculator()
        self.retro = RetrogradeDetector()
        logger.info("GannFeatureEngineer initialized")
    
    def add_gann_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add all Gann-related features to DataFrame.
        
        Args:
            df: DataFrame with OHLC data and planetary positions
            
        Returns:
            Enhanced DataFrame with Gann features
        """
        logger.info("Adding Gann features to dataset...")
        df_gann = df.copy()
        
        # Ensure required columns exist
        if 'Close' not in df_gann.columns:
            logger.error("'Close' column not found in DataFrame")
            return df_gann
        
        # 1. Detect swing points
        logger.debug("Detecting swing points...")
        try:
            swings = self.swing_detector.detect(df_gann)
            major_swings = self.swing_detector.get_major_swings(swings, threshold_percent=3.0)
        except Exception as e:
            logger.warning(f"Swing detection failed: {e}. Using default values.")
            major_swings = []
        
        # 2. Calculate Gann angles from most recent major swing low and high
        if len(major_swings) >= 2:
            # Find most recent low and high
            from astro_finance.gann.swing_detector import SwingType
            
            recent_lows = [s for s in major_swings if s.swing_type == SwingType.LOW]
            recent_highs = [s for s in major_swings if s.swing_type == SwingType.HIGH]
            
            if recent_lows:
                last_low = recent_lows[-1]
                bullish_angles = self.gann_calculator.calculate_angles_from_point(
                    origin_date=last_low.date,
                    origin_price=last_low.price,
                    df=df_gann,
                    angle_type='bullish'
                )
                
                # Calculate distance from 1x1 and 2x1 angles
                df_gann['Gann_Distance_1x1_Bull'] = 0.0
                df_gann['Gann_Distance_2x1_Bull'] = 0.0
                
                for i, row in df_gann.iterrows():
                    if i >= last_low.date:
                        price_1x1 = bullish_angles['1x1'].price_at_date(i)
                        price_2x1 = bullish_angles['2x1'].price_at_date(i)
                        
                        # Percentage distance
                        df_gann.loc[i, 'Gann_Distance_1x1_Bull'] = \
                            (row['Close'] - price_1x1) / price_1x1 * 100
                        df_gann.loc[i, 'Gann_Distance_2x1_Bull'] = \
                            (row['Close'] - price_2x1) / price_2x1 * 100
                
                # Trend strength flag
                df_gann['Gann_Above_1x1'] = (df_gann['Gann_Distance_1x1_Bull'] > 0).astype(int)
            
            if recent_highs:
                last_high = recent_highs[-1]
                bearish_angles = self.gann_calculator.calculate_angles_from_point(
                    origin_date=last_high.date,
                    origin_price=last_high.price,
                    df=df_gann,
                    angle_type='bearish'
                )
                
                # Calculate distance from bearish 1x1
                df_gann['Gann_Distance_1x1_Bear'] = 0.0
                
                for i, row in df_gann.iterrows():
                    if i >= last_high.date:
                        price_1x1 = bearish_angles['1x1'].price_at_date(i)
                        df_gann.loc[i, 'Gann_Distance_1x1_Bear'] = \
                            (row['Close'] - price_1x1) / price_1x1 * 100
        else:
            # No swings detected - use default features
            df_gann['Gann_Distance_1x1_Bull'] = 0.0
            df_gann['Gann_Distance_2x1_Bull'] = 0.0
            df_gann['Gann_Above_1x1'] = 0
            df_gann['Gann_Distance_1x1_Bear'] = 0.0
        
        # 3. Square of 9 harmonic features
        logger.debug("Calculating Square of 9 features...")
        df_gann['SQ9_Nearest_Harmonic_Dist'] = 0.0
        
        for i, row in df_gann.iterrows():
            # Distance to nearest perfect square
            nearest_sq = self.sq9.find_nearest_square_value(row['Close'])
            df_gann.loc[i, 'SQ9_Nearest_Harmonic_Dist'] = \
                (row['Close'] - nearest_sq) / row['Close'] * 100
        
        # 4. Swing proximity features
        df_gann['Days_Since_Swing_High'] = 999
        df_gann['Days_Since_Swing_Low'] = 999
        
        if len(major_swings) > 0:
            from astro_finance.gann.swing_detector import SwingType
            
            for i, date in enumerate(df_gann.index):
                # Find most recent swing before this date
                prior_swings = [s for s in major_swings if s.date <= date]
                
                if prior_swings:
                    prior_highs = [s for s in prior_swings if s.swing_type == SwingType.HIGH]
                    prior_lows = [s for s in prior_swings if s.swing_type == SwingType.LOW]
                    
                    if prior_highs:
                        last_high_date = prior_highs[-1].date
                        df_gann.iloc[i, df_gann.columns.get_loc('Days_Since_Swing_High')] = \
                            (date - last_high_date).days
                    
                    if prior_lows:
                        last_low_date = prior_lows[-1].date
                        df_gann.iloc[i, df_gann.columns.get_loc('Days_Since_Swing_Low')] = \
                            (date - last_low_date).days
        
        logger.info(f"Added {len([c for c in df_gann.columns if 'Gann' in c or 'SQ9' in c or 'Swing' in c])} Gann features")
        return df_gann
    
    def add_lunar_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add lunar phase sentiment features."""
        logger.info("Adding lunar phase features...")
        df_lunar = df.copy()
        
        lunar_data = []
        for date in df_lunar.index:
            sentiment = self.lunar.calculate_lunar_sentiment(date.to_pydatetime())
            lunar_data.append({
                'Lunar_Illumination': sentiment['illumination'],
                'Lunar_Volatility_Index': sentiment['volatility_index'],
                'Lunar_Bullish_Bias': sentiment['bullish_bias'],
                'Lunar_Energy_Level': sentiment['energy_level']
            })
        
        lunar_df = pd.DataFrame(lunar_data, index=df_lunar.index)
        df_lunar = pd.concat([df_lunar, lunar_df], axis=1)
        
        logger.info(f"Added {len(lunar_df.columns)} lunar features")
        return df_lunar
    
    def add_retrograde_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add planetary retrograde features."""
        logger.info("Adding retrograde features...")
        
        planets = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']
        df_retro = self.retro.add_retrograde_features(df, planets=planets)
        
        num_features = len([c for c in df_retro.columns if 'Retrograde' in c])
        logger.info(f"Added {num_features} retrograde features")
        return df_retro
    
    def add_all_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add all Gann, Lunar, and Retrograde features.
        
        This is the main method to use for full feature enhancement.
        """
        logger.info("Adding all Gann Theory features to dataset...")
        
        df_enhanced = df.copy()
        
        # Add each feature set
        df_enhanced = self.add_gann_features(df_enhanced)
        df_enhanced = self.add_lunar_features(df_enhanced)
        df_enhanced = self.add_retrograde_features(df_enhanced)
        
        # Fill any NaN values
        df_enhanced.fillna(0, inplace=True)
        
        total_new_features = len(df_enhanced.columns) - len(df.columns)
        logger.info(f"✅ Total new features added: {total_new_features}")
        
        return df_enhanced


def create_enhanced_dataset(
    planets_df: pd.DataFrame,
    stock_df: pd.DataFrame,
    output_path: str = None
) -> pd.DataFrame:
    """
    Complete pipeline to create enhanced dataset with all features.
    
    Args:
        planets_df: DataFrame with planetary positions
        stock_df: DataFrame with OHLC stock data
        output_path: Optional path to save enhanced dataset
        
    Returns:
        Enhanced DataFrame ready for ML training
    """
    from astro_finance.features.engineering import FeatureEngineer
    
    # 1. Standard feature engineering (existing)
    fe = FeatureEngineer()
    df_merged = fe.merge_data(planets_df, stock_df)
    df_encoded = fe.encode_features(df_merged)
    
    # 2. Add Gann Theory features (new)
    gann_fe = GannFeatureEngineer()
    df_final = gann_fe.add_all_features(df_encoded)
    
    # 3. Save if path provided
    if output_path:
        df_final.to_csv(output_path)
        logger.info(f"Enhanced dataset saved to {output_path}")
    
    logger.info(f"Final dataset shape: {df_final.shape}")
    return df_final
