
import sys
from loguru import logger
from pathlib import Path

# Configure Loguru
logger.remove()
logger.add(sys.stderr, level="INFO")
logger.add("app.log", rotation="10 MB", retention="10 days", level="DEBUG")

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PROCESSED_DATA_PATH = DATA_DIR / "processed" / "merged_data.csv"

# Model Configs
NEURAL_HMM_CONFIG = {
    "sequence_length": 30,  # Increased from 20
    "hidden_dim": 128,      # Increased from 32 for higher capacity
    "n_layers": 2,
    "epochs": 20,
    "learning_rate": 0.001
}

XGBOOST_CONFIG = {
    "n_estimators": 100,
    "learning_rate": 0.1,
    "max_depth": 5,
    "random_state": 42
}

# Feature Engineering
# We allow Returns and Volatility as inputs (Auto-Regressive)
# The model uses Past(t-seq...t-1) to predict Target(t)
EXCLUDED_COLS = [
    'Close', 'Open', 'High', 'Low', 'Adj Close', 
    'Crash_Minor', 'Crash_Major', 
    'Market_Regime'
]

def get_exclude_cols(data_columns):
    """Dynamically generate exclusion list including Target_* columns"""
    excludes = EXCLUDED_COLS.copy()
    excludes.extend([c for c in data_columns if c.startswith('Target_')])
    return excludes
