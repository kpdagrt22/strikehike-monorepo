"""
Retrain Models with Gann Features

Comprehensive retraining pipeline for:
1. Crash prediction models (Minor/Major crashes)
2. Market regime prediction models
3. XGBoost with hyperparameter tuning
4. LSTM/Neural models enhancement

Goal: Improve upon existing accuracies:
- XGBoost: 97.17% → 98%+
- LSTM: 75.97% → 78%+
- Neural HMM: 68.07% → 70%+
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

import pandas as pd
import numpy as np
from datetime import datetime
from loguru import logger
import joblib
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
import xgboost as xgb

# Configure logger
logger.add("logs/model_retraining.log", rotation="10 MB")


def load_gann_enhanced_data():
    """Load the Gann-enhanced dataset."""
    logger.info("Loading Gann-enhanced dataset...")
    
    data_path = Path("data/processed/final_data_with_gann.csv")
    df = pd.read_csv(data_path, index_col=0, parse_dates=True)
    
    logger.info(f"Dataset shape: {df.shape}")
    logger.info(f"Date range: {df.index[0]} to {df.index[-1]}")
    
    # Identify Gann features
    gann_features = [c for c in df.columns if 'Gann' in c or 'Lunar' in c or 
                     'SQ9' in c or 'Swing' in c or 'Retrograde' in c]
    logger.info(f"Gann features found: {len(gann_features)}")
    
    return df


def prepare_crash_prediction_data(df, target='Crash_Minor'):
    """
    Prepare data for crash prediction.
    
    Target can be 'Crash_Minor' (10% drop) or 'Crash_Major' (20% drop)
    """
    logger.info(f"Preparing data for {target} prediction...")
    
    # Drop rows with missing target
    df_clean = df.dropna(subset=[target]).copy()
    
    # Define features to exclude from training
    exclude_cols = [
        'Close', 'Returns', 'Volatility',
        'Crash_Minor', 'Crash_Major',
        'Target_1W', 'Target_1M', 'Target_1Y', 'Target_3Y',
        'Market_Regime'
    ]
    
    # Get feature columns
    feature_cols = [c for c in df_clean.columns if c not in exclude_cols]
    
    X = df_clean[feature_cols]
    y = df_clean[target]
    
    logger.info(f"Features: {len(feature_cols)}")
    logger.info(f"Samples: {len(X)}")
    logger.info(f"Positive class (crash): {y.sum()} ({y.mean()*100:.2f}%)")
    
    return X, y, feature_cols


def prepare_regime_prediction_data(df):
    """Prepare data for market regime prediction."""
    logger.info("Preparing data for market regime prediction...")
    
    df_clean = df.dropna(subset=['Market_Regime']).copy()
    
    exclude_cols = [
        'Close', 'Returns', 'Volatility',
        'Crash_Minor', 'Crash_Major',
        'Target_1W', 'Target_1M', 'Target_1Y', 'Target_3Y',
        'Market_Regime'
    ]
    
    feature_cols = [c for c in df_clean.columns if c not in exclude_cols]
    
    X = df_clean[feature_cols]
    y = df_clean['Market_Regime']
    
    logger.info(f"Features: {len(feature_cols)}")
    logger.info(f"Samples: {len(X)}")
    logger.info(f"Regime distribution:\n{y.value_counts()}")
    
    return X, y, feature_cols


def train_crash_model_with_tuning(X, y, feature_cols):
    """
    Train XGBoost crash prediction model with hyperparameter tuning.
    """
    logger.info("="*60)
    logger.info("CRASH PREDICTION MODEL TRAINING")
    logger.info("="*60)
    
    # Split data (time-series aware)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    logger.info(f"Train size: {len(X_train)}, Test size: {len(X_test)}")
    
    # Hyperparameter grid (focused on Gann features)
    param_grid = {
        'max_depth': [6, 8, 10],
        'learning_rate': [0.01, 0.05, 0.1],
        'n_estimators': [200, 300, 500],
        'min_child_weight': [1, 3, 5],
        'subsample': [0.8, 0.9, 1.0],
        'colsample_bytree': [0.8, 0.9, 1.0],
        'scale_pos_weight': [float(sum(y_train == 0)) / float(sum(y_train == 1))]  # Handle class imbalance
    }
    
    # Create XGBoost classifier
    xgb_model = xgb.XGBClassifier(
        objective='binary:logistic',
        random_state=42,
        n_jobs=-1,
        eval_metric='logloss'
    )
    
    # Grid search with cross-validation
    logger.info("Starting hyperparameter tuning (this may take a while)...")
    grid_search = GridSearchCV(
        xgb_model,
        param_grid,
        cv=3,  # Time-series split would be better but keeping simple for speed
        scoring='accuracy',
        verbose=1,
        n_jobs=-1
    )
    
    grid_search.fit(X_train, y_train)
    
    best_model = grid_search.best_estimator_
    best_params = grid_search.best_params_
    
    logger.info(f"Best parameters: {best_params}")
    
    # Evaluate
    y_pred_train = best_model.predict(X_train)
    y_pred_test = best_model.predict(X_test)
    
    train_acc = accuracy_score(y_train, y_pred_train)
    test_acc = accuracy_score(y_test, y_pred_test)
    
    logger.info(f"\n🎯 RESULTS:")
    logger.info(f"Train Accuracy: {train_acc*100:.2f}%")
    logger.info(f"Test Accuracy: {test_acc*100:.2f}%")
    
    logger.info(f"\nClassification Report:\n{classification_report(y_test, y_pred_test)}")
    
    # Feature importance (top 20)
    feature_importance = pd.DataFrame({
        'Feature': feature_cols,
        'Importance': best_model.feature_importances_
    }).sort_values('Importance', ascending=False)
    
    logger.info(f"\nTop 20 Important Features:")
    for idx, row in feature_importance.head(20).iterrows():
        logger.info(f"  {row['Feature']}: {row['Importance']:.4f}")
    
    # Check Gann feature importance
    gann_features_in_top = feature_importance.head(20)
    gann_features_in_top = gann_features_in_top[
        gann_features_in_top['Feature'].str.contains('Gann|Lunar|SQ9|Swing|Retrograde')
    ]
    logger.info(f"\n✨ Gann features in top 20: {len(gann_features_in_top)}")
    
    # Save model
    model_path = Path("data/processed/crash_model_with_gann.joblib")
    joblib.dump(best_model, model_path)
    logger.info(f"\n✅ Model saved to {model_path}")
    
    return best_model, test_acc, feature_importance


def train_regime_model_with_tuning(X, y, feature_cols):
    """
    Train XGBoost regime prediction model with hyperparameter tuning.
    """
    logger.info("="*60)
    logger.info("MARKET REGIME PREDICTION MODEL TRAINING")
    logger.info("="*60)
    
    # Split data
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    logger.info(f"Train size: {len(X_train)}, Test size: {len(X_test)}")
    
    # Hyperparameter grid
    param_grid = {
        'max_depth': [6, 8, 10],
        'learning_rate': [0.01, 0.05, 0.1],
        'n_estimators': [200, 300, 500],
        'min_child_weight': [1, 3, 5],
        'subsample': [0.8, 0.9],
        'colsample_bytree': [0.8, 0.9]
    }
    
    xgb_model = xgb.XGBClassifier(
        objective='multi:softmax',
        num_class=len(y.unique()),
        random_state=42,
        n_jobs=-1
    )
    
    logger.info("Starting hyperparameter tuning...")
    grid_search = GridSearchCV(
        xgb_model,
        param_grid,
        cv=3,
        scoring='accuracy',
        verbose=1,
        n_jobs=-1
    )
    
    grid_search.fit(X_train, y_train)
    
    best_model = grid_search.best_estimator_
    best_params = grid_search.best_params_
    
    logger.info(f"Best parameters: {best_params}")
    
    # Evaluate
    y_pred_train = best_model.predict(X_train)
    y_pred_test = best_model.predict(X_test)
    
    train_acc = accuracy_score(y_train, y_pred_train)
    test_acc = accuracy_score(y_test, y_pred_test)
    
    logger.info(f"\n🎯 RESULTS:")
    logger.info(f"Train Accuracy: {train_acc*100:.2f}%")
    logger.info(f"Test Accuracy: {test_acc*100:.2f}%")
    
    logger.info(f"\nClassification Report:\n{classification_report(y_test, y_pred_test)}")
    
    # Feature importance
    feature_importance = pd.DataFrame({
        'Feature': feature_cols,
        'Importance': best_model.feature_importances_
    }).sort_values('Importance', ascending=False)
    
    logger.info(f"\nTop 20 Important Features:")
    for idx, row in feature_importance.head(20).iterrows():
        logger.info(f"  {row['Feature']}: {row['Importance']:.4f}")
    
    # Save model
    model_path = Path("data/processed/regime_model_with_gann.joblib")
    joblib.dump(best_model, model_path)
    logger.info(f"\n✅ Model saved to {model_path}")
    
    return best_model, test_acc, feature_importance


def compare_with_baseline():
    """Compare new results with baseline."""
    logger.info("="*60)
    logger.info("COMPARISON WITH BASELINE")
    logger.info("="*60)
    
    baseline = {
        'XGBoost (Regime)': 97.17,
        'LSTM': 75.97,
        'Neural HMM': 68.07
    }
    
    logger.info("\nBaseline Accuracies:")
    for model, acc in baseline.items():
        logger.info(f"  {model}: {acc:.2f}%")


def main():
    """Run complete model retraining pipeline."""
    logger.info("🚀 Starting Model Retraining with Gann Features")
    logger.info(f"Timestamp: {datetime.now()}")
    logger.info("="*60)
    
    try:
        # Load data
        df = load_gann_enhanced_data()
        
        # Compare with baseline
        compare_with_baseline()
        
        # Train Crash Prediction Model
        logger.info("\n" + "="*60)
        logger.info("1. CRASH PREDICTION MODEL (Minor Crashes)")
        logger.info("="*60)
        
        X_crash, y_crash, crash_features = prepare_crash_prediction_data(df, 'Crash_Minor')
        crash_model, crash_acc, crash_importance = train_crash_model_with_tuning(
            X_crash, y_crash, crash_features
        )
        
        # Train Regime Prediction Model
        logger.info("\n" + "="*60)
        logger.info("2. MARKET REGIME PREDICTION MODEL")
        logger.info("="*60)
        
        X_regime, y_regime, regime_features = prepare_regime_prediction_data(df)
        regime_model, regime_acc, regime_importance = train_regime_model_with_tuning(
            X_regime, y_regime, regime_features
        )
        
        # Final Summary
        logger.info("\n" + "="*60)
        logger.info("✅ RETRAINING COMPLETE!")
        logger.info("="*60)
        
        logger.info(f"\n📊 NEW ACCURACIES:")
        logger.info(f"  Crash Prediction (Minor): {crash_acc*100:.2f}%")
        logger.info(f"  Market Regime Prediction: {regime_acc*100:.2f}%")
        
        logger.info(f"\n📈 IMPROVEMENT:")
        logger.info(f"  Regime: 97.17% → {regime_acc*100:.2f}% ({(regime_acc*100 - 97.17):+.2f}%)")
        
        logger.info(f"\n📁 MODELS SAVED:")
        logger.info(f"  - data/processed/crash_model_with_gann.joblib")
        logger.info(f"  - data/processed/regime_model_with_gann.joblib")
        
        logger.info(f"\n🎯 NEXT STEPS:")
        logger.info(f"  1. Review feature importance to understand Gann impact")
        logger.info(f"  2. Test models on recent data for validation")
        logger.info(f"  3. Integrate into API for real-time predictions")
        logger.info(f"  4. (Optional) Fine-tune LSTM with Gann features")
        
        # Save summary
        summary = {
            'timestamp': datetime.now().isoformat(),
            'crash_accuracy': float(crash_acc),
            'regime_accuracy': float(regime_acc),
            'baseline_regime': 97.17,
            'improvement': float(regime_acc * 100 - 97.17)
        }
        
        import json
        with open('data/processed/retraining_summary.json', 'w') as f:
            json.dump(summary, f, indent=2)
        
    except Exception as e:
        logger.error(f"Error during retraining: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
