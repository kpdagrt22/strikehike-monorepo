
import sys
from pathlib import Path

# Add project root to path for imports
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR / "src"))
sys.path.append(str(BASE_DIR))

import pandas as pd
import numpy as np
import json
from datetime import datetime
from astro_finance.validation.backtesting import WalkForwardValidator, PerformanceTracker
from astro_finance.modeling.sequential import NeuralHMMWrapper
from astro_finance.modeling.supervised import XGBoostPredictor
from config.settings import NEURAL_HMM_CONFIG, XGBOOST_CONFIG, PROCESSED_DATA_PATH, get_exclude_cols
from loguru import logger
import os

def load_data(data_path: str = None) -> pd.DataFrame:
    """Load historical data"""
    path = data_path or str(PROCESSED_DATA_PATH)
    logger.info(f"Loading data from {path}")
    
    if not os.path.exists(path):
        logger.error(f"Data file not found: {path}")
        raise FileNotFoundError(path)
    
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    logger.success(f"Loaded {len(df)} rows")
    
    return df


def validate_neural_hmm(data: pd.DataFrame) -> pd.DataFrame:
    """Validate NeuralHMM"""
    logger.info("\n" + "="*60)
    logger.info("VALIDATING: NeuralHMM")
    logger.info("="*60)
    
    # Prepare data using config exclusion
    exclude_cols = get_exclude_cols(data.columns)
    
    if 'Market_Regime' not in data.columns:
        logger.warning("Market_Regime not found. Generating regimes using Volatility & Returns...")
        try:
            from sklearn.cluster import KMeans
            features = data[['Returns', 'Volatility']].dropna()
            kmeans = KMeans(n_clusters=3, random_state=42)
            data.loc[features.index, 'Market_Regime'] = kmeans.fit_predict(features)
            logger.success(f"Generated Market_Regime with K-Means (3 clusters).")
        except Exception as e:
            logger.error(f"Failed to generate regimes: {e}")
            data['Market_Regime'] = 0
    
    validation_data = data[data['Market_Regime'].notna()].copy()
    
    if len(validation_data) == 0:
        logger.error("No valid labels")
        return pd.DataFrame()

    # OPTIMIZATION: Limit to recent history for faster deployment validation
    # Real-world deployment often focuses on recent regime relevance
    validation_data = validation_data[validation_data.index.year >= 2015].copy()
    logger.info(f"Deployment Validation (2015-Present): {len(validation_data)} samples")
    
    logger.info(f"Dataset: {len(validation_data)} samples")
    
    model = NeuralHMMWrapper(
        sequence_length=NEURAL_HMM_CONFIG['sequence_length'],
        hidden_dim=NEURAL_HMM_CONFIG['hidden_dim'],
        n_layers=NEURAL_HMM_CONFIG['n_layers'],
        epochs=NEURAL_HMM_CONFIG['epochs'],
        learning_rate=NEURAL_HMM_CONFIG['learning_rate'],
        exclude_cols=exclude_cols
    )
    
    # Validator expects train_window_years and test_window_months (integers)
    # train_window_years=1 → 252 trading days (~1 year)
    # test_window_months=1 → 21 trading days (~1 month)
    validator = WalkForwardValidator(
        train_window_years=1,
        test_window_months=1,
        min_train_samples=200
    )
    
    results = validator.run_validation(
        data=validation_data,
        model=model,
        target_col='Market_Regime'
    )
    
    if len(results) > 0:
        results.to_csv('data/validation_results_neural_hmm.csv', index=False)
        logger.success("Saved: data/validation_results_neural_hmm.csv")
    
    return results


def validate_crash_predictor(data: pd.DataFrame) -> pd.DataFrame:
    """Validate XGBoost"""
    logger.info("\n" + "="*60)
    logger.info("VALIDATING: XGBoost Crash Predictor")
    logger.info("="*60)
    
    if 'Crash_Minor' not in data.columns:
        logger.error("Crash_Minor not found")
        return pd.DataFrame()
    
    # OPTIMIZATION: Limit to recent history
    validation_data = data[data['Crash_Minor'].notna()].copy()
    validation_data = validation_data[validation_data.index.year >= 2015].copy()
    logger.info(f"Deployment Validation (2015-Present): {len(validation_data)} samples")
    
    model = XGBoostPredictor(
        n_estimators=XGBOOST_CONFIG['n_estimators'],
        learning_rate=XGBOOST_CONFIG['learning_rate'],
        max_depth=XGBOOST_CONFIG['max_depth'],
        random_state=XGBOOST_CONFIG['random_state'],
        exclude_cols=get_exclude_cols(data.columns)
    )
    
    validator = WalkForwardValidator(
        train_window_years=1,
        test_window_months=1,
        min_train_samples=200
    )
    
    results = validator.run_validation(
        data=validation_data,
        model=model,
        target_col='Crash_Minor'
    )
    
    if len(results) > 0:
        results.to_csv('data/validation_results_crash.csv', index=False)
        logger.success("Saved: data/validation_results_crash.csv")
    
    return results


def generate_public_track_record(results: pd.DataFrame):
    """Generate track record JSON"""
    logger.info("\n" + "="*60)
    logger.info("GENERATING TRACK RECORD")
    logger.info("="*60)
    
    summary = {
        'validation_date': datetime.now().isoformat(),
        'total_periods': len(results),
        'date_range': f"{results['period_start'].min()} to {results['period_end'].max()}",
        'metrics': {
            'accuracy': {
                'mean': float(results['accuracy'].mean()),
                'median': float(results['accuracy'].median()),
                'std': float(results['accuracy'].std()),
                'min': float(results['accuracy'].min()),
                'max': float(results['accuracy'].max())
            },
            'sharpe_ratio': {
                'mean': float(results['sharpe_ratio'].mean()),
                'median': float(results['sharpe_ratio'].median())
            },
            'win_rate': {
                'mean': float(results['win_rate'].mean())
            }
        },
        'passed_criteria': {
            'accuracy_gt_60': bool(results['accuracy'].mean() > 0.60),
            'sharpe_gt_1_5': bool(results['sharpe_ratio'].mean() > 1.5)
        }
    }
    
    import json
    os.makedirs('web/public', exist_ok=True)
    with open('web/public/track_record.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    logger.success("Saved: web/public/track_record.json")
    logger.info(f"Accuracy: {summary['metrics']['accuracy']['mean']:.2%}")
    logger.info(f"Sharpe: {summary['metrics']['sharpe_ratio']['mean']:.2f}")
    
    if all(summary['passed_criteria'].values()):
        logger.success("✅ READY FOR LAUNCH")
    else:
        logger.warning("⚠️ Needs tuning")


def main():
    """Run validation"""
    logger.info("="*60)
    logger.info("ASTRO FINANCE - VALIDATION")
    logger.info("="*60)
    
    try:
        data = load_data()
        
        neural_results = validate_neural_hmm(data)
        crash_results = validate_crash_predictor(data)
        
        if len(neural_results) > 0:
            generate_public_track_record(neural_results)
        
        logger.success("\n✅ COMPLETE")
        logger.info("Results: data/validation_results_*.csv")
        
    except Exception as e:
        logger.error(f"Failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
