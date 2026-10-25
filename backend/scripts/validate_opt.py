
"""
Optimized Model Validation Script
================================
Runs on recent data for fast feedback loop.
"""

from astro_finance.validation.backtesting import WalkForwardValidator
from astro_finance.modeling.sequential import NeuralHMMWrapper
from astro_finance.modeling.supervised import XGBoostPredictor
from loguru import logger
import pandas as pd
import numpy as np
import os
from datetime import datetime

def load_data(data_path: str = "data/processed/merged_data.csv") -> pd.DataFrame:
    logger.info(f"Loading data from {data_path}")
    df = pd.read_csv(data_path, index_col=0, parse_dates=True)
    # Use last 3000 rows (~12 years) for faster validation
    df = df.tail(3000).copy()
    logger.success(f"Loaded {len(df)} rows (subset)")
    return df

def validate_neural_hmm(data: pd.DataFrame) -> pd.DataFrame:
    logger.info("\n" + "="*60)
    logger.info("VALIDATING: NeuralHMM (Fast)")
    logger.info("="*60)
    
    if 'Market_Regime' not in data.columns:
        logger.warning("Generating Regimes...")
        from sklearn.cluster import KMeans
        # Generate regimes
        features_regime = data[['Returns', 'Volatility']].dropna()
        kmeans = KMeans(n_clusters=3, random_state=42)
        data.loc[features_regime.index, 'Market_Regime'] = kmeans.fit_predict(features_regime)
    
    # 1. Handle NaNs globally
    data = data.ffill().fillna(0)
    
    # 2. Select ONLY Feature Columns (Drop Targets/Future info)
    # Keep Date index, Astro features, and specific Target
    exclude_cols = ['Close', 'Open', 'High', 'Low', 'Volume', 'Adj Close', 
                    'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major']
    # Exclude Target_* columns
    exclude_cols.extend([c for c in data.columns if c.startswith('Target_')])
    
    # But keep 'Market_Regime' as it is our target for this function
    feature_cols = [c for c in data.columns if c not in exclude_cols]
    
    # Create validation set with Features + Target
    validation_data = data[feature_cols + ['Market_Regime']].copy()
    
    logger.info(f"Features: {len(feature_cols)} columns (e.g. {feature_cols[:3]})")
    
    model = NeuralHMMWrapper(sequence_length=20, hidden_dim=32, epochs=5)
    
    validator = WalkForwardValidator(
        train_window_years=1,
        test_window_months=3,  # Larger steps = fewer periods = faster
        min_train_samples=200
    )
    
    try:
        results = validator.run_validation(
            data=validation_data,
            model=model,
            target_col='Market_Regime'
        )
        if len(results) > 0:
            results.to_csv('data/validation_results_neural_hmm_opt.csv', index=False)
            logger.success("Saved optimized results")
        return results
    except Exception as e:
        logger.error(f"Validation failed: {e}")
        import traceback
        with open('error.log', 'w') as f:
            traceback.print_exc(file=f)
        return pd.DataFrame()

def validate_crash_predictor(data: pd.DataFrame) -> pd.DataFrame:
    logger.info("\n" + "="*60)
    logger.info("VALIDATING: XGBoost (Fast)")
    logger.info("="*60)
    
    # 1. Clean Data
    data = data.ffill().fillna(0)
    
    # 2. Select Columns
    model_exclusions = ['Close', 'Open', 'High', 'Low', 'Volume', 'Adj Close', 
                        'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major', 
                        'Market_Regime']
    model_exclusions.extend([c for c in data.columns if c.startswith('Target_')])
    
    feature_cols = [c for c in data.columns if c not in model_exclusions]
    validator_cols = feature_cols + ['Crash_Minor', 'Returns']
    
    # Validation data
    validation_data = data[validator_cols].copy()
    
    # Fewer estimators
    model = XGBoostPredictor(
        n_estimators=50, 
        learning_rate=0.05,
        exclude_cols=model_exclusions
    )
    
    validator = WalkForwardValidator(
        train_window_years=1,
        test_window_months=3,
        min_train_samples=200
    )
    
    results = validator.run_validation(
        data=validation_data,
        model=model,
        target_col='Crash_Minor'
    )
    
    if len(results) > 0:
        results.to_csv('data/validation_results_crash_opt.csv', index=False)
    return results

def main():
    data = load_data()
    
    neural_results = validate_neural_hmm(data)
    crash_results = validate_crash_predictor(data)
    
    if len(neural_results) > 0:
        acc = neural_results['accuracy'].mean()
        sharpe = neural_results['sharpe_ratio'].mean()
        logger.info(f"\nFINAL PERFORMANCE:\nAccuracy: {acc:.2%}\nSharpe: {sharpe:.2f}")

if __name__ == "__main__":
    main()
