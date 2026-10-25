
import sys
from pathlib import Path

# Add project root
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR / "src"))
sys.path.append(str(BASE_DIR))

import pandas as pd
import numpy as np
import itertools
from astro_finance.modeling.sequential import NeuralHMMWrapper
from config.settings import PROCESSED_DATA_PATH, get_exclude_cols
from loguru import logger

def tune_neural_hmm():
    logger.info("Starting NeuralHMM Hyperparameter Tuning...")
    
    # Load Data
    data = pd.read_csv(PROCESSED_DATA_PATH, index_col=0, parse_dates=True)
    data = data.tail(4000).ffill().fillna(0) # Use more data for tuning
    
    # Generate Target
    if 'Market_Regime' not in data.columns:
        from sklearn.cluster import KMeans
        features = data[['Returns', 'Volatility']].dropna()
        kmeans = KMeans(n_clusters=3, random_state=42)
        data.loc[features.index, 'Market_Regime'] = kmeans.fit_predict(features)
        
    validation_data = data[data['Market_Regime'].notna()].copy()
    
    # Split 80/20
    train_size = int(len(validation_data) * 0.8)
    train_df = validation_data.iloc[:train_size].copy()
    test_df = validation_data.iloc[train_size:].copy()
    
    exclude_cols = get_exclude_cols(validation_data.columns)
    
    # Grid Search Space
    param_grid = {
        'hidden_dim': [32, 64, 128],
        'n_layers': [1, 2],
        'sequence_length': [10, 20, 30]
    }
    
    best_acc = 0
    best_params = {}
    
    keys, values = zip(*param_grid.items())
    combinations = [dict(zip(keys, v)) for v in itertools.product(*values)]
    
    logger.info(f"Testing {len(combinations)} combinations...")
    
    for i, params in enumerate(combinations):
        logger.info(f"[{i+1}/{len(combinations)}] Testing: {params}")
        
        try:
            model = NeuralHMMWrapper(
                sequence_length=params['sequence_length'],
                hidden_dim=params['hidden_dim'],
                n_layers=params['n_layers'],
                epochs=5, # Quick check
                learning_rate=0.001,
                exclude_cols=exclude_cols
            )
            
            model.fit(train_df, target_col='Market_Regime')
            
            # Predict
            preds = model.predict(test_df)
            actuals = test_df['Market_Regime'].values[-len(preds):]
            
            acc = (preds == actuals).mean()
            logger.success(f"Accuracy: {acc:.2%}")
            
            if acc > best_acc:
                best_acc = acc
                best_params = params
                logger.success(f"🌟 NEW BEST: {best_acc:.2%}")
                
        except Exception as e:
            logger.error(f"Failed with params {params}: {e}")
            
    logger.info("="*30)
    logger.success(f"BEST ACCURACY: {best_acc:.2%}")
    logger.success(f"BEST PARAMS: {best_params}")
    logger.info("="*30)
    
    with open('tuning_results.txt', 'w') as f:
        f.write(f"Best Accuracy: {best_acc:.2%}\n")
        f.write(f"Best Params: {best_params}\n")

if __name__ == "__main__":
    tune_neural_hmm()
