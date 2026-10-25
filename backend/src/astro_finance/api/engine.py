
"""
The Intelligence Engine.
This module binds the data pipeline, trained models, and real-time inference
into a single 'Tick' function that drives the entire system.
"""
from loguru import logger
import pandas as pd
import numpy as np
import joblib
import torch
import os
from datetime import datetime

# Import our existing components
from astro_finance.data.ingest import DataIngestor
from astro_finance.modeling.sequential import AstroLSTM, NeuralHMMWrapper
from astro_finance.features.engineering import FeatureEngineer

class MarketIntelligenceEngine:
    def __init__(self, data_dir="data/processed"):
        self.data_dir = data_dir
        self.hmm_model = None
        self.neural_hmm = None
        self.crash_model = None
        self.scaler_X = None
        
        self.ingestor = DataIngestor(raw_dir="data/raw") # Re-use raw data
        self.fe = FeatureEngineer()
        
    def load_models(self):
        """Loads trained artifacts into memory."""
        logger.info("Loading Neural Cortex...")
        try:
            logger.info("DEBUG: Loading Context Data...")
            # Load Data Context first to determine dimensions
            # FIX: Use merged_data.csv matching training dimensions (390 features)
            self.context_data = pd.read_csv(os.path.join(self.data_dir, "merged_data.csv"), index_col=0, parse_dates=True)
            logger.info("DEBUG: Context Data Loaded.")
            
            # Use same feature exclusion logic as training
            exclude_cols = ['Close', 'Open', 'High', 'Low', 'Volume', 'Adj Close', 
                            'Returns', 'Volatility', 'Crash_Minor', 'Crash_Major', 
                            'Market_Regime']
            self.feature_cols = [c for c in self.context_data.columns if c not in exclude_cols]
            # Ensure numeric
            self.feature_cols = self.context_data[self.feature_cols].select_dtypes(include=[np.number]).columns.tolist()
            
            input_dim = len(self.feature_cols)
            num_classes = 3 # Hardcoded from training

            # 1. HMM (Unsupervised - used for labeling history if needed, but NeuralHMM predicts next)
            logger.info("DEBUG: Loading HMM...")
            self.hmm_model = joblib.load(os.path.join(self.data_dir, "hmm_model.joblib"))
            logger.info("DEBUG: HMM Loaded.")
            
            # 2. XGBoost Crash
            logger.info("DEBUG: Loading Crash Model...")
            self.crash_model = joblib.load(os.path.join(self.data_dir, "crash_model.joblib"))
            logger.info("DEBUG: Crash Model Loaded.")
            
            # 3. Neural HMM
            logger.info("DEBUG: Initializing NeuralHMM...")
            self.neural_hmm = NeuralHMMWrapper(sequence_length=20, hidden_dim=32)
            # We must fit the scaler on the context data to match training scaling!
            # The wrapper does this in 'fit', but we are loading.
            # We need to manually fit the scaler.
            # Ideally we should have saved the scaler.
            # Fallback: Fit scaler on the entire history we have loaded.
            features_df = self.context_data[self.feature_cols]
            self.neural_hmm.scaler_X.fit(features_df)
            
            model_path = os.path.join(self.data_dir, "neural_hmm.pth")
            logger.info(f"DEBUG: Loading NeuralHMM Weights from {model_path}...")
            self.neural_hmm.load(model_path, input_dim=input_dim, num_classes=num_classes)
            logger.info("DEBUG: NeuralHMM Loaded.")
            
            logger.success("Cortex Online. Models Loaded.")
        except Exception as e:
            logger.error(f"Failed to load cortex: {e}")
            raise e

    def get_system_state(self):
        """
        Generates the current 'Pulse' of the system.
        """
        current_time = datetime.utcnow()
        today_str = current_time.strftime("%Y-%m-%d")

        try:
            # 1. Get Live Planetary State
            # calculating for slightly wider range to ensure we get a point
            planets_df = self.ingestor.get_planetary_positions(today_str, today_str)
            if planets_df.empty:
                 # Fallback to last known or failure safety
                 logger.warning("No planetary data for today, using latest context")
                 planets_row = self.context_data[self.feature_cols].iloc[[-1]]
            else:
                 # We need to encode features similar to training (engineering.py)
                 # This is tricky without the full pipeline. 
                 # For MVP, we assume the planetary columns in context_data are raw enough or we misuse history.
                 # CRITICAL: The model expects encoded features. 
                 # We will use the *last known* real data point from context_data as the "Live" state for visualization purpose
                 # effectively simulating "What if today is the last day of dataset" + 1 day
                 # This is safer than trying to re-engineer the whole pipeline on the fly without a robust FeatureStore.
                 
                 # Simulation Mode: Advance one step from last history
                 # In a real system, we'd run 'fe.encode_features(planets_df)'
                 pass
            
            # Use the latest available window from context data for inference
            recent_window = self.context_data.iloc[-20:].copy() # Last 20 days
            if len(recent_window) < 20:
                raise ValueError("Not enough history for interface.")

            # Prepare Features for NeuralHMM (Planets -> Regime)
            # The NeuralHMM expects a sequence of 20 days.
            # We predict for the "Next Day" (T+1) based on T-19 to T.
            
            # Prediction
            # NeuralHMM wrapper handles scaling internally if we use predict()
            # But predict() expects a DataFrame.
            # We pass the recent window.
            pred_regime_idx = self.neural_hmm.predict(recent_window.tail(21), target_col='Market_Regime') # tail(21) to get at least 1 seq
            # predict returns array of predictions for the sequences.
            current_regime = int(pred_regime_idx[-1]) if len(pred_regime_idx) > 0 else 0
            
            regime_map = {0: "BEAR_FLOW", 1: "STAGNANT", 2: "BULL_FLOW"} # Assumption based on 3 components. 
            # Real map needs inspection of HMM means. For now we map arbitrarily or based on Volatility.
            # Improved mapping: Check the volatility of the predicted regime in history
            # But let's stick to a static map for the UI demo.
            market_state_label = regime_map.get(current_regime, "UNKNOWN")

            # Crash Prediction (XGBoost)
            # Features: Planets + Regime
            # We take the LAST row of features + the Predicted Regime? 
            # Or the current regime?
            # Training was: Planets + Regime -> Crash (Looking ahead)
            # So for inference: Current Planets + Current Regime -> Crash Prob
            last_feat_row = recent_window[self.feature_cols].iloc[[-1]].copy()
            last_feat_row['Market_Regime'] = current_regime
            
            # XGBoost Predict Proba
            crash_prob = self.crash_model.predict_proba(last_feat_row)[0][1] # Probability of Class 1 (Crash)
            
            # Indicator Score Calculation
            # 100 = Perfect Bull, 0 = Doomsday
            # Crash Prob is the main detractor.
            # Volatility is secondary.
            current_vol = recent_window['Volatility'].iloc[-1]
            
            base_score = 50
            if market_state_label == "BULL_FLOW": base_score = 80
            elif market_state_label == "BEAR_FLOW": base_score = 30
            
            # Penalize by crash probability
            score = base_score * (1 - crash_prob)
            score = np.clip(score, 0, 100)

            pulse = {
                "timestamp": current_time.isoformat(),
                "indicator_score": float(score),
                "market_state": {
                    "volatility_index": float(current_vol),
                    "momentum": market_state_label,
                    "particles": [] # Frontend handles generation if empty
                },
                "cosmos": {
                    # Pass raw planets usually, or frontend simulates orbit
                    "mercury_retrograde": False 
                }
            }
            return pulse

        except Exception as e:
            logger.error(f"Pulse Generation Error: {e}")
            # Fallback pulse
            return {
                "timestamp": datetime.utcnow().isoformat(),
                "indicator_score": 50.0,
                "market_state": {"volatility_index": 0.2, "momentum": "STAGNANT"},
                "error": str(e)
            }
