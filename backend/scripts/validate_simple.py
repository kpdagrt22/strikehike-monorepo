
import sys
import os
from pathlib import Path

# Add project root to path for imports
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR / "src"))
sys.path.append(str(BASE_DIR))

import pandas as pd
import numpy as np
from astro_finance.modeling.sequential import NeuralHMMWrapper
from astro_finance.modeling.supervised import XGBoostPredictor
from config.settings import NEURAL_HMM_CONFIG, XGBOOST_CONFIG, PROCESSED_DATA_PATH, get_exclude_cols
from loguru import logger

logger.remove()
logger.add(sys.stderr, level="INFO")

def validate_simple():
    logger.info("Starting Simple Validation (80/20 Split)...")
    
    # Load Data
    data_path = PROCESSED_DATA_PATH
    logger.info(f"Loading data from {data_path}")
    data = pd.read_csv(data_path, index_col=0, parse_dates=True)
    
    # Use config-defined cleaning
    data = data.tail(3000).ffill().fillna(0)
    
    # Generate Target
    if 'Market_Regime' not in data.columns:
        from sklearn.cluster import KMeans
        features = data[['Returns', 'Volatility']]
        kmeans = KMeans(n_clusters=3, random_state=42)
        data['Market_Regime'] = kmeans.fit_predict(features)
        
    # Split
    train_size = int(len(data) * 0.8)
    train_df = data.iloc[:train_size].copy()
    test_df = data.iloc[train_size:].copy()
    
    logger.info(f"Train: {len(train_df)}, Test: {len(test_df)}")
    
    # NeuralHMM
    logger.info("Training NeuralHMM...")
    exclude_cols = get_exclude_cols(data.columns)
    
    # Use config
    model = NeuralHMMWrapper(
        sequence_length=NEURAL_HMM_CONFIG['sequence_length'],
        hidden_dim=NEURAL_HMM_CONFIG['hidden_dim'],
        epochs=NEURAL_HMM_CONFIG['epochs'],
        learning_rate=NEURAL_HMM_CONFIG['learning_rate'],
        exclude_cols=exclude_cols
    )
    
    model.fit(train_df, target_col='Market_Regime')
    
    predictions = model.predict(test_df)
    actuals = test_df['Market_Regime'].values[-len(predictions):]
    
    acc = (predictions == actuals).mean()
    logger.success(f"NeuralHMM Accuracy: {acc:.2%}")
    
    # XGBoost
    logger.info("Training XGBoost...")
    model_xgb = XGBoostPredictor(
        n_estimators=XGBOOST_CONFIG['n_estimators'],
        learning_rate=XGBOOST_CONFIG['learning_rate'],
        exclude_cols=exclude_cols
    )
    model_xgb.fit(train_df, target_col='Crash_Minor')
    preds_xgb = model_xgb.predict(test_df)
    
    # For crash, round output to binary? Regression objective.
    # XGBoostPredictor creates Regression model. Crash_Minor is 0/1.
    # Simple threshold 0.5
    preds_binary = (preds_xgb > 0.5).astype(int)
    actuals_crash = test_df['Crash_Minor'].values
    
    acc_xgb = (preds_binary == actuals_crash).mean()
    logger.success(f"XGBoost Accuracy: {acc_xgb:.2%}")
    
    with open('results.txt', 'w') as f:
        f.write(f"NeuralHMM Accuracy: {acc:.2%}\n")
        f.write(f"XGBoost Accuracy: {acc_xgb:.2%}\n")

if __name__ == "__main__":
    validate_simple()
