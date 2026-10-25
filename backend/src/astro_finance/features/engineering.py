import pandas as pd
from astro_finance.common.logger import configure_logger

logger = configure_logger()

class FeatureEngineer:
    def __init__(self):
        pass

    def merge_data(self, planets_df: pd.DataFrame, stock_df: pd.DataFrame) -> pd.DataFrame:
        """Merges planetary positions and stock data."""
        logger.info("Merging planetary and stock data...")
        
        # 1. Base is planets (daily)
        df_combined = planets_df.sort_index().copy()
        
        # 2. Merge Stock Data
        # Left join on planets to keep all dates
        df_final = df_combined.join(stock_df, how='left')
        
        # Forward fill stock prices
        df_final['Close'] = df_final['Close'].ffill()
        
        # Drop rows where we still don't have stock data (start of time?)
        df_final.dropna(subset=['Close'], inplace=True)
        
        # --- Feature Engineering for Crashes ---
        # 1. Volatility (20-day rolling std dev of returns)
        df_final['Returns'] = df_final['Close'].pct_change()
        df_final['Volatility'] = df_final['Returns'].rolling(window=20).std()
        
        # 2. Crash Label (Forward Looking)
        # We need to ensure we don't leak future data into the training set features
        # BUT we are creating TARGETS here. 'Crash_Minor' IS the target.
        # We also need features that predict it. The features are planets.
        
        # A "Minor Crash" is defined as a >10% drop in the next 20 days.
        # A "Major Crash" is defined as a >20% drop in the next 20 days.
        
        # Look ahead 20 days
        indexer_20 = pd.api.indexers.FixedForwardWindowIndexer(window_size=20)
        future_min = df_final['Close'].rolling(window=indexer_20).min()
        
        # Calculate max drawdown from current price to the minimum in the next 20 days
        drawdown = (df_final['Close'] - future_min) / df_final['Close']
        
        df_final['Crash_Minor'] = (drawdown >= 0.10).astype(int)
        df_final['Crash_Major'] = (drawdown >= 0.20).astype(int)
        
        # 3. Multi-Horizon Targets (Regression)
        # 1 Week (5 days), 1 Month (20), 1 Year (252), 3 Year (756)
        # We model the RETURN over this period
        df_final['Target_1W'] = df_final['Close'].shift(-5) / df_final['Close'] - 1
        df_final['Target_1M'] = df_final['Close'].shift(-20) / df_final['Close'] - 1
        df_final['Target_1Y'] = df_final['Close'].shift(-252) / df_final['Close'] - 1
        df_final['Target_3Y'] = df_final['Close'].shift(-756) / df_final['Close'] - 1
        
        # For training, we can't have NaNs in the TARGET columns if we are training on them.
        # However, for 3Y target, we lose the last 3 years of data!
        # Strategy: We only drop rows where 1M target is missing (since that's our primary daily focus?)
        # Or we keep them as separate datasets.
        # For now, let's just create the columns. The Model class handle dropna based on the specific target it's training for.
        
        # Clean up very short term NaNs (volatility needs 20 days)
        df_final.dropna(subset=['Returns', 'Volatility'], inplace=True)

        logger.debug(f"Merged Data Shape: {df_final.shape}")
        return df_final

    def encode_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Encodes categorical features for model training."""
        logger.info("Encoding categorical features...")
        # Identify object columns (Events like Rashi/Nakshatra)
        cat_cols = df.select_dtypes(include=['object']).columns
        if len(cat_cols) > 0:
            logger.debug(f"Categorical columns found: {list(cat_cols)}")
            df_encoded = pd.get_dummies(df, columns=cat_cols, drop_first=True)
            # Ensure boolean becomes int (0/1) for compatibility
            # In pandas 2.0+, get_dummies might return bool
            # We ONLY want to convert boolean columns to int, NOT floats
            for col in df_encoded.columns:
                if df_encoded[col].dtype == 'bool':
                    df_encoded[col] = df_encoded[col].astype(int)
            return df_encoded
            return df_encoded
        return df
