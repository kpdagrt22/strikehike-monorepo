from typing import Tuple, Optional
import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from loguru import logger
import joblib
from sklearn.preprocessing import StandardScaler

class MarketRegimeHMM:
    """
    Hidden Markov Model for Market Regime Detection.
    Identifies latent states (e.g., Bull, Bear, Sideways) from observed data.
    """
    
    def __init__(self, n_components: int = 3, covariance_type: str = "full", n_iter: int = 100, random_state: int = 42, min_covar: float = 1e-3):
        self.n_components = n_components
        self.model = GaussianHMM(
            n_components=n_components, 
            covariance_type=covariance_type, 
            n_iter=n_iter, 
            random_state=random_state,
            verbose=False,
            min_covar=min_covar
        )
        self.scaler = StandardScaler()
        self.is_fitted = False
        self._state_map = {} # To map 0,1,2 to human readable labels if possible (heuristic)

    def fit(self, X: pd.DataFrame) -> 'MarketRegimeHMM':
        """
        Fits the HMM model to the data.
        X should be a DataFrame of features (e.g., Returns, Volatility).
        """
        logger.info(f"Fitting HMM with {self.n_components} components...")
        
        # Validate input
        if X.isnull().values.any():
            logger.warning("Input data contains NaNs. Dropping them for training.")
            X = X.dropna()
            
        # Scale data
        X_scaled = self.scaler.fit_transform(X)
        
        self.model.fit(X_scaled)
        self.is_fitted = True
        
        logger.success("HMM Model fitted successfully.")
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        """
        Predicts the hidden states (market regimes) for the input data.
        """
        if not self.is_fitted:
            raise ValueError("Model is not fitted yet. Call fit() first.")
            
        X_clean = X.dropna()
        if len(X_clean) != len(X):
             logger.warning("Input data for prediction had NaNs dropped. Length mismatch possible.")
        
        X_scaled = self.scaler.transform(X_clean)
        states = self.model.predict(X_scaled)
        
        return states

    def save(self, path: str):
        """Saves the model to disk."""
        joblib.dump(self, path)
        logger.info(f"HMM model saved to {path}")

    @staticmethod
    def load(path: str) -> 'MarketRegimeHMM':
        """Loads a model from disk."""
        model = joblib.load(path)
        logger.info(f"HMM model loaded from {path}")
        return model
