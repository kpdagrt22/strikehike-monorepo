
import pandas as pd
import numpy as np
from astro_finance.validation.backtesting import WalkForwardValidator
from astro_finance.modeling.supervised import XGBoostPredictor
from loguru import logger
import sys

# Configure logger
logger.remove()
logger.add(sys.stderr, level="INFO")

def debug():
    data_path = "data/processed/merged_data.csv"
    logger.info(f"Loading {data_path}...")
    df = pd.read_csv(data_path, index_col=0, parse_dates=True)
    logger.info(f"Loaded {len(df)} rows")
    
    # Check Targets
    if 'Crash_Minor' in df.columns:
        counts = df['Crash_Minor'].value_counts(dropna=False)
        logger.info(f"Crash_Minor counts:\n{counts}")
    else:
        logger.error("Crash_Minor not found in columns")
        
    # Check Market Regime
    if 'Market_Regime' not in df.columns:
        logger.warning("Market_Regime not found, creating dummy")
        df['Market_Regime'] = 0
    
    # Simulate Validation Logic
    logger.info("\nTesting Manual Validation Step...")
    
    # Setup just like validate_models.py
    validation_data = df[df['Crash_Minor'].notna()].copy()
    logger.info(f"Validation Data Len: {len(validation_data)}")
    
    validator = WalkForwardValidator(
        train_window_years=1,
        test_window_months=1,
        min_train_samples=200
    )
    
    train_window = validator.train_window
    test_window = validator.test_window
    
    logger.info(f"Train Window: {train_window}, Test Window: {test_window}")
    
    # Try first iteration
    i = 0
    train_start_idx = max(0, i)
    train_end_idx = i + train_window
    train_data = validation_data.iloc[train_start_idx:train_end_idx].copy()
    
    test_start_idx = train_end_idx
    test_end_idx = test_start_idx + test_window
    test_data = validation_data.iloc[test_start_idx:test_end_idx].copy()
    
    logger.info(f"Sample 0 Train Len: {len(train_data)}")
    logger.info(f"Sample 0 Test Len: {len(test_data)}")
    
    if len(train_data) < 200:
        logger.error("Insufficient training data in first fold")
    
    # Try running actual validator for 1 period?
    # We can patch the range in the class or just verify loop
    total_periods = (len(validation_data) - train_window) // test_window
    logger.info(f"Expected Total Periods: {total_periods}")
    
    if total_periods <= 0:
        logger.error("Total periods is <= 0! Check data length vs window sizes.")

    # Try XGBoost fit
    logger.info("\nTest Fitting XGBoost...")
    model = XGBoostPredictor(n_estimators=10)
    try:
        model.fit(train_data, df['Crash_Minor'].iloc[train_start_idx:train_end_idx])
        preds = model.predict(test_data)
        logger.success(f"Prediction successful. Shape: {preds.shape}")
        logger.info(f"Sample preds: {preds[:5]}")
    except Exception as e:
        logger.error(f"Fit/Predict failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug()
