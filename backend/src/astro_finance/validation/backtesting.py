"""
Walk-Forward Backtesting Framework
===================================

Gold-standard validation to prevent overfitting.
Trains on historical window, tests on future period (no peeking).

Academic Standard: The only way to prove a model works.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from loguru import logger
import json


@dataclass
class BacktestResult:
    """Single backtest period result"""
    period_start: str
    period_end: str
    accuracy: float
    precision: float
    recall: float
    f1_score: float
    sharpe_ratio: float
    max_drawdown: float
    total_return: float
    num_trades: int
    win_rate: float
    predictions: List[Dict]
    actuals: List[float]


class WalkForwardValidator:
    """
    Walk-Forward Analysis Implementation
    
    Standard in quantitative finance for preventing overfitting.
    
    Process:
    1. Train on Year 1-5, test on Year 6
    2. Train on Year 2-6, test on Year 7
    3. Repeat for entire dataset
    
    This ensures the model hasn't "seen" the test data.
    """
    
    def __init__(
        self, 
        train_window_years: int = 5,
        test_window_months: int = 6,
        min_train_samples: int = 1000
    ):
        self.train_window = train_window_years * 252  # Trading days
        self.test_window = test_window_months * 21  # ~21 trading days/month
        self.min_train_samples = min_train_samples
        
        logger.info(f"WalkForward Config: {train_window_years}Y train, {test_window_months}M test")
    
    def run_validation(
        self, 
        data: pd.DataFrame,
        model,
        target_col: str = 'Market_Regime',
        metric_cols: Optional[List[str]] = None
    ) -> pd.DataFrame:
        """
        Run walk-forward validation
        
        Args:
            data: Historical data with features and targets
            model: Model object with fit() and predict() methods
            target_col: Column name for target variable
            metric_cols: Additional columns for performance metrics
        
        Returns:
            DataFrame with results for each test period
        """
        results = []
        total_periods = (len(data) - self.train_window) // self.test_window
        
        logger.info(f"Starting walk-forward with {total_periods} test periods")
        
        for i in range(0, len(data) - self.train_window - self.test_window, self.test_window):
            try:
                # Get training window
                train_start_idx = max(0, i)
                train_end_idx = i + self.train_window
                train_data = data.iloc[train_start_idx:train_end_idx].copy()
                
                if len(train_data) < self.min_train_samples:
                    logger.warning(f"Skipping period {i}: insufficient training data")
                    continue
                
                # Get test window (future data - no peeking!)
                test_start_idx = train_end_idx
                test_end_idx = test_start_idx + self.test_window
                test_data = data.iloc[test_start_idx:test_end_idx].copy()
                
                if len(test_data) == 0:
                    break
                
                logger.info(f"Period {len(results)+1}/{total_periods}: "
                           f"Train {train_data.index[0]} to {train_data.index[-1]}, "
                           f"Test {test_data.index[0]} to {test_data.index[-1]}")
                
                # Train model on historical data
                model.fit(train_data, target_col=target_col)
                
                # Predict on future data
                # Handle sequence models needing lookback context
                lookback = getattr(model, 'sequence_length', 0)
                if lookback > 0:
                    pred_start_idx = max(0, test_start_idx - lookback)
                    pred_data = data.iloc[pred_start_idx:test_end_idx].copy()
                else:
                    pred_data = test_data
                
                predictions = model.predict(pred_data)
                actuals = test_data[target_col].values
                
                # Calculate metrics
                metrics = self._calculate_metrics(
                    predictions=predictions,
                    actuals=actuals,
                    test_data=test_data,
                    metric_cols=metric_cols or []
                )
                
                result = BacktestResult(
                    period_start=str(test_data.index[0]),
                    period_end=str(test_data.index[-1]),
                    accuracy=metrics['accuracy'],
                    precision=metrics['precision'],
                    recall=metrics['recall'],
                    f1_score=metrics['f1'],
                    sharpe_ratio=metrics['sharpe'],
                    max_drawdown=metrics['max_drawdown'],
                    total_return=metrics['total_return'],
                    num_trades=len(predictions),
                    win_rate=metrics['win_rate'],
                    predictions=predictions.tolist() if hasattr(predictions, 'tolist') else predictions,
                    actuals=actuals.tolist()
                )
                
                results.append(result)
                
                logger.success(f"Period complete: Accuracy={metrics['accuracy']:.2%}, "
                              f"Sharpe={metrics['sharpe']:.2f}")
                
            except Exception as e:
                logger.error(f"Error in period {i}: {e}")
                continue
        
        # Convert to DataFrame
        if len(results) == 0:
            logger.warning("No validation periods completed")
            return pd.DataFrame()
        
        results_df = pd.DataFrame([{
            'period_start': r.period_start,
            'period_end': r.period_end,
            'accuracy': r.accuracy,
            'precision': r.precision,
            'recall': r.recall,
            'f1_score': r.f1_score,
            'sharpe_ratio': r.sharpe_ratio,
            'max_drawdown': r.max_drawdown,
            'total_return': r.total_return,
            'num_trades': r.num_trades,
            'win_rate': r.win_rate
        } for r in results])
        
        self._print_summary(results_df)
        
        return results_df
    
    def _calculate_metrics(
        self, 
        predictions: np.ndarray,
        actuals: np.ndarray,
        test_data: pd.DataFrame,
        metric_cols: List[str]
    ) -> Dict[str, float]:
        """Calculate all performance metrics"""
        
        # Classification metrics
        correct = (predictions == actuals).sum()
        accuracy = correct / len(actuals) if len(actuals) > 0 else 0.0
        
        # Precision, Recall, F1 (for multi-class, use macro average)
        from sklearn.metrics import precision_score, recall_score, f1_score
        precision = precision_score(actuals, predictions, average='macro', zero_division=0)
        recall = recall_score(actuals, predictions, average='macro', zero_division=0)
        f1 = f1_score(actuals, predictions, average='macro', zero_division=0)
        
        # Trading metrics (if returns available)
        if 'Returns' in test_data.columns:
            returns = test_data['Returns'].values
            
            # Simple strategy: Go long when regime is bullish (regime 2)
            # This is placeholder - customize based on your regime mapping
            strategy_returns = np.where(predictions == 2, returns, -returns * 0.5)
            
            # Sharpe Ratio (annualized)
            sharpe = self._calculate_sharpe(strategy_returns)
            
            # Max Drawdown
            cumulative_returns = (1 + strategy_returns).cumprod()
            running_max = np.maximum.accumulate(cumulative_returns)
            drawdown = (cumulative_returns - running_max) / running_max
            max_drawdown = drawdown.min()
            
            # Total Return
            total_return = cumulative_returns[-1] - 1 if len(cumulative_returns) > 0 else 0.0
            
            # Win Rate
            wins = (strategy_returns > 0).sum()
            win_rate = wins / len(strategy_returns) if len(strategy_returns) > 0 else 0.0
        else:
            sharpe = 0.0
            max_drawdown = 0.0
            total_return = 0.0
            win_rate = 0.0
        
        return {
            'accuracy': accuracy,
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'sharpe': sharpe,
            'max_drawdown': max_drawdown,
            'total_return': total_return,
            'win_rate': win_rate
        }
    
    def _calculate_sharpe(self, returns: np.ndarray, risk_free_rate: float = 0.02) -> float:
        """Calculate annualized Sharpe ratio"""
        if len(returns) == 0 or returns.std() == 0:
            return 0.0
        
        excess_returns = returns - (risk_free_rate / 252)  # Daily risk-free rate
        sharpe = np.sqrt(252) * (excess_returns.mean() / returns.std())
        return sharpe
    
    def _print_summary(self, results_df: pd.DataFrame):
        """Print summary statistics"""
        logger.info("\n" + "="*60)
        logger.info("WALK-FORWARD VALIDATION SUMMARY")
        logger.info("="*60)
        
        logger.info(f"Total Periods: {len(results_df)}")
        logger.info(f"\nAccuracy:")
        logger.info(f"  Mean: {results_df['accuracy'].mean():.2%}")
        logger.info(f"  Median: {results_df['accuracy'].median():.2%}")
        logger.info(f"  Std Dev: {results_df['accuracy'].std():.2%}")
        logger.info(f"  Min: {results_df['accuracy'].min():.2%}")
        logger.info(f"  Max: {results_df['accuracy'].max():.2%}")
        
        logger.info(f"\nSharpe Ratio:")
        logger.info(f"  Mean: {results_df['sharpe_ratio'].mean():.2f}")
        logger.info(f"  Median: {results_df['sharpe_ratio'].median():.2f}")
        
        logger.info(f"\nMax Drawdown:")
        logger.info(f"  Average: {results_df['max_drawdown'].mean():.2%}")
        logger.info(f"  Worst: {results_df['max_drawdown'].min():.2%}")
        
        logger.info(f"\nWin Rate:")
        logger.info(f"  Average: {results_df['win_rate'].mean():.2%}")
        
        logger.info("="*60 + "\n")
        
        # Success criteria
        avg_accuracy = results_df['accuracy'].mean()
        avg_sharpe = results_df['sharpe_ratio'].mean()
        
        if avg_accuracy > 0.60 and avg_sharpe > 1.5:
            logger.success("✅ MODEL VALIDATION PASSED")
            logger.success(f"   Accuracy: {avg_accuracy:.2%} (Target: >60%)")
            logger.success(f"   Sharpe: {avg_sharpe:.2f} (Target: >1.5)")
        else:
            logger.warning("⚠️  MODEL NEEDS IMPROVEMENT")
            if avg_accuracy <= 0.60:
                logger.warning(f"   Accuracy: {avg_accuracy:.2%} (Target: >60%)")
            if avg_sharpe <= 1.5:
                logger.warning(f"   Sharpe: {avg_sharpe:.2f} (Target: >1.5)")


# Simplified PerformanceTracker for now
class PerformanceTracker:
    """Track live predictions vs actuals for transparency"""
    
    def __init__(self, db_path: str = "data/predictions.db"):
        self.db_path = db_path
        self.predictions = []
    
    def log_prediction(self, timestamp: datetime, symbol: str, prediction_type: str,
                      predicted_value: float, confidence: float, metadata: Optional[Dict] = None):
        """Log a prediction for future validation"""
        record = {
            'timestamp': timestamp.isoformat(),
            'symbol': symbol,
            'prediction_type': prediction_type,
            'predicted_value': predicted_value,
            'confidence': confidence,
            'metadata': metadata or {}
        }
        self.predictions.append(record)
        logger.info(f"Logged prediction: {prediction_type}={predicted_value:.2f} (confidence: {confidence:.2%})")


if __name__ == "__main__":
    logger.info("Backtesting framework ready")
