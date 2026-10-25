
from omegaconf import OmegaConf
from astro_finance.data.ingest import DataIngestor
from astro_finance.features.engineering import FeatureEngineer
from astro_finance.modeling.clustering import MarketRegimeHMM
from astro_finance.modeling.supervised import XGBoostPredictor
from astro_finance.modeling.sequential import AstroLSTM, NeuralHMMWrapper
from loguru import logger
import hydra
from omegaconf import DictConfig
import pandas as pd
import numpy as np
import os
import torch

def main():
    logger.info("Starting Astro Finance Pipeline (Manual Execution)...")
    
    # --- Configuration ---
    # We define it inline for simplicity in this run, or load from file
    cfg = OmegaConf.create({
        "app": {"name": "astro_finance_manual"},
        "data": {
            "start_date": "1990-01-01", # Extended history for better training
            "end_date": "2023-01-01",
            "raw_dir": "data/raw",
            "processed_dir": "data/processed",
            "stock_ticker": "^DJI"
        },
        "model": {
            "hmm_components": 3,
            "lstm_seq_len": 20,
            "epochs": 15
        }
    })
    
    # Initialize components
    ingestor = DataIngestor(raw_dir=cfg.data.raw_dir)
    fe = FeatureEngineer()
    
    # --- 1. Load & Process Data ---
    logger.info("Loading Data...")
    p_df = ingestor.get_planetary_positions(cfg.data.start_date, cfg.data.end_date)
    s_df = ingestor.fetch_stock_data(cfg.data.stock_ticker, cfg.data.start_date, cfg.data.end_date)
    
    merged_df = fe.merge_data(p_df, s_df)
    merged_df = fe.encode_features(merged_df)
    
    # Save processed base data
    output_file = os.path.join(cfg.data.processed_dir, "merged_data.csv")
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    merged_df.to_csv(output_file)
    logger.info(f"Saved merged data to {output_file}")
    
    # Use valid data for training (dropna for HMM features)
    # HMM uses Returns and Volatility
    train_df = merged_df.dropna(subset=['Returns', 'Volatility']).copy()
    
    # --- 2. Market Regime Detection (Unsupervised HMM) ---
    logger.info("Training Market Regime Model (HMM)...")
    
    hmm_features = ['Returns', 'Volatility']
    hmm_model = MarketRegimeHMM(n_components=cfg.model.hmm_components, n_iter=100)
    hmm_model.fit(train_df[hmm_features])
    
    # Predict Regimes for the whole dataset
    regimes = hmm_model.predict(train_df[hmm_features])
    train_df['Market_Regime'] = regimes
    
    logger.info(f"Identified Regimes distribution: {pd.Series(regimes).value_counts()}")
    hmm_model.save("data/processed/hmm_model.joblib")
    
    # --- 3. NeuralHMM (Supervised: Planets -> Regime) ---
    logger.info("Training NeuralHMM (Planets -> Regime)...")
    
    # Features for NeuralHMM: Planetary inputs only (we want to predict regime from planets)
    # Exclude price-derived columns + Date + Targets
    exclude_cols = ['Close', 'Open', 'High', 'Low', 'Volume', 'Adj Close', 
                    'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major', 
                    'Market_Regime'] # Target
    
    feature_cols = [c for c in train_df.columns if c not in exclude_cols]
    # Filter only numeric columns
    feature_cols = train_df[feature_cols].select_dtypes(include=[np.number]).columns.tolist()
    
    logger.info(f"NeuralHMM Features ({len(feature_cols)}): {feature_cols[:5]}...")
    
    # NeuralHMM needs specific dataframe structure
    nhmm_df = train_df[feature_cols + ['Market_Regime']].copy()
    
    nhmm = NeuralHMMWrapper(
        sequence_length=cfg.model.lstm_seq_len, 
        epochs=cfg.model.epochs,
        hidden_dim=32
    )
    
    # Fit (Internally handles scaling and sequence creation)
    nhmm.fit(nhmm_df, target_col='Market_Regime')
    nhmm.save("data/processed/neural_hmm.pth")
    
    # Generate Regime Predictions for next step (Crash Prediction models often benefit from predicted regime)
    # Note: For training crash model, we can use *actual* regimes from HMM as ground truth during training,
    # or use *predicted* regimes. Using actual HMM labels is better for training the crash model to learn 
    # the relationship "Regime X + Planets -> Crash".
    
    # --- 4. Crash Prediction (Supervised: Planets + Regime -> Crash) ---
    logger.info("Training Crash Predictor (XGBoost)...")
    
    target_crash = 'Crash_Minor' # >10% drop
    
    # Prepare features for Crash Prediction
    # We include 'Market_Regime' as a feature!
    crash_feature_cols = feature_cols + ['Market_Regime']
    
    X = train_df[crash_feature_cols]
    y = train_df[target_crash]
    
    # Time Series Split
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    # Handle Imbalance? Crash is rare.
    scale_pos_weight = (len(y_train) - y_train.sum()) / y_train.sum()
    
    xgb_crash = XGBoostPredictor(
        n_estimators=100, 
        learning_rate=0.05
        # scale_pos_weight=scale_pos_weight # Optional: heavily weights crashes
    )
    xgb_crash.fit(X_train, y_train)
    
    # Evaluate
    metrics = xgb_crash.evaluate(X_test, y_test)
    logger.info(f"Crash Model Metrics: {metrics}")
    
    xgb_crash.save("data/processed/crash_model.joblib")
    
    # --- Conclusion ---
    logger.success("Pipeline Completed Successfully.")
    logger.info("Models saved: HMM (Regime Labeler), NeuralHMM (Regime Predictor), XGBoost (Crash Predictor)")

import traceback
import sys

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
