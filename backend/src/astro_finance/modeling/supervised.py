from typing import Dict, Any, Optional
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_squared_error, r2_score
from loguru import logger
import joblib

class XGBoostPredictor:
    """
    XGBoost Regressor for Financial Prediction.
    Uses gradient boosting to model non-linear relationships between
    planetary features, market regimes, and stock prices.
    """
    
    def __init__(self, n_estimators: int = 100, learning_rate: float = 0.1, max_depth: int = 5, 
                 random_state: int = 42, exclude_cols: List[str] = None):
        self.model = xgb.XGBRegressor(
            n_estimators=n_estimators,
            learning_rate=learning_rate,
            max_depth=max_depth,
            random_state=random_state,
            objective='reg:squarederror',
            n_jobs=-1
        )
        self.is_fitted = False
        self.feature_names = None
        self.exclude_cols = exclude_cols or []

    def fit(self, X: pd.DataFrame, y: Optional[pd.Series] = None, target_col: str = None) -> 'XGBoostPredictor':
        """
        Trains the XGBoost model.
        Supports both (X, y) and (data, target_col) interfaces.
        """
        if target_col is not None and isinstance(X, pd.DataFrame):
            logger.info(f"Training XGBoost with dataframe and target '{target_col}'...")
            y = X[target_col]
            # Use exclude_cols + target_col
            drop_cols = [target_col] + [c for c in self.exclude_cols if c in X.columns]
            X = X.drop(columns=drop_cols)
        
        logger.info(f"Training XGBoost with {X.shape[1]} features...")
        
        self.feature_names = X.columns.tolist()
        
        self.model.fit(X, y, verbose=False)
        self.is_fitted = True
        
        logger.success("XGBoost Model trained successfully.")
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """
        Predicts target (e.g., Price or Returns).
        """
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
            
        # Align features to training data
        if self.feature_names:
            # Ensure all features exist, ignore extras (like target)
            missing = [f for f in self.feature_names if f not in X.columns]
            if missing:
                raise ValueError(f"Missing features: {missing}")
            X = X[self.feature_names]
            
        return self.model.predict(X)

    def evaluate(self, X: pd.DataFrame, y: pd.Series) -> Dict[str, float]:
        """
        Evaluates the model on test data.
        """
        preds = self.predict(X)
        rmse = np.sqrt(mean_squared_error(y, preds))
        r2 = r2_score(y, preds)
        
        logger.info(f"Model Evaluation - RMSE: {rmse:.4f}, R2: {r2:.4f}")
        return {"rmse": rmse, "r2": r2}

    def get_feature_importance(self) -> pd.DataFrame:
        """
        Returns feature importance.
        """
        if not self.is_fitted:
            raise ValueError("Model not fitted.")
            
        importance = self.model.feature_importances_
        df_imp = pd.DataFrame({
            'Feature': self.feature_names,
            'Importance': importance
        }).sort_values(by='Importance', ascending=False)
        
        return df_imp

    def save(self, path: str):
        joblib.dump(self, path)
        logger.info(f"XGBoost model saved to {path}")

    @staticmethod
    def load(path: str) -> 'XGBoostPredictor':
        model = joblib.load(path)
        logger.info(f"XGBoost model loaded from {path}")
        return model
