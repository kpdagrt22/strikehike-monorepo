
import pandas as pd
import numpy as np
from astro_finance.modeling.sequential import NeuralHMMWrapper
from loguru import logger
import sys
import traceback

logger.remove()
logger.add(sys.stderr, level="INFO")

def debug_neural():
    try:
        # Load Data
        data = pd.read_csv("data/processed/merged_data.csv", index_col=0, parse_dates=True)
        data = data.tail(3000).ffill().fillna(0)
        
        # Generate Regimes if needed
        if 'Market_Regime' not in data.columns:
            logger.info("Generating regimes...")
            from sklearn.cluster import KMeans
            features = data[['Returns', 'Volatility']]
            kmeans = KMeans(n_clusters=3, random_state=42)
            data['Market_Regime'] = kmeans.fit_predict(features)
            
        # Select Features (Clean)
        exclude_cols = ['Close', 'Open', 'High', 'Low', 'Volume', 'Adj Close', 
                        'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major', 'Market_Regime']
        exclude_cols.extend([c for c in data.columns if c.startswith('Target_')])
        feature_cols = [c for c in data.columns if c not in exclude_cols]
        
        # Use Features + Target
        df = data[feature_cols + ['Market_Regime']].copy()
        
        logger.info(f"Data shape: {df.shape}")
        logger.info(f"Feature count: {len(feature_cols)}")
        
        # Split (Year 1 Train, Month 1 Test)
        train_len = 252
        test_len = 21
        
        train_df = df.iloc[:train_len].copy()
        test_df = df.iloc[train_len:train_len+test_len].copy()
        
        logger.info("Initializing Model...")
        model = NeuralHMMWrapper(sequence_length=20, hidden_dim=32, epochs=2)
        
        logger.info(f"Fitting on {len(train_df)} rows...")
        model.fit(train_df, target_col='Market_Regime')
        
        logger.info(f"Predicting on {len(test_df)} rows...")
        preds = model.predict(test_df)
        
        logger.success(f"Predictions: {preds}")
        
    except Exception as e:
        logger.error(f"FAILURE: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    debug_neural()
