import torch
import torch.nn as nn
import torch.optim as optim
import pandas as pd
import numpy as np
from torch.utils.data import DataLoader, TensorDataset
from loguru import logger
from typing import Tuple, List, Optional
import joblib

class LSTMModel(nn.Module):
    """
    Standard LSTM Network for Time Series.
    """
    def __init__(self, input_dim: int, hidden_dim: int, output_dim: int, n_layers: int, dropout: float = 0.2):
        super(LSTMModel, self).__init__()
        self.hidden_dim = hidden_dim
        self.n_layers = n_layers
        
        self.lstm = nn.LSTM(input_dim, hidden_dim, n_layers, batch_first=True, dropout=dropout)
        self.fc = nn.Linear(hidden_dim, output_dim)
        
    def forward(self, x):
        # x shape: (batch, seq_len, input_dim)
        # h0, c0 initialized to 0 by default
        out, (hn, cn) = self.lstm(x)
        
        # We want the output of the last time step
        # out shape: (batch, seq_len, hidden_dim)
        last_time_step = out[:, -1, :]
        
        out = self.fc(last_time_step)
        return out

from sklearn.preprocessing import StandardScaler

class AstroLSTM:
    """
    Wrapper for training and evaluating the LSTM Model.
    """
    def __init__(self, sequence_length: int = 10, hidden_dim: int = 64, n_layers: int = 2, learning_rate: float = 0.001, epochs: int = 20):
        self.sequence_length = sequence_length
        self.hidden_dim = hidden_dim
        self.n_layers = n_layers
        self.learning_rate = learning_rate
        self.epochs = epochs
        
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.criterion = nn.MSELoss()
        self.scaler_X = StandardScaler()
        self.scaler_y = StandardScaler()
        
    def _create_sequences(self, data: pd.DataFrame, target_col: str, fit_scaler: bool = False) -> Tuple[np.ndarray, np.ndarray]:
        """
        Creates sliding window sequences from the dataframe.
        """
        features_df = data.drop(columns=[target_col])
        target_series = data[target_col].values.reshape(-1, 1)
        
        if fit_scaler:
            X_scaled = self.scaler_X.fit_transform(features_df)
            y_scaled = self.scaler_y.fit_transform(target_series)
        else:
            X_scaled = self.scaler_X.transform(features_df)
            y_scaled = self.scaler_y.transform(target_series)
            
        features = X_scaled
        target = y_scaled.flatten()
        
        X, y = [], []
        for i in range(len(data) - self.sequence_length):
            X.append(features[i : i + self.sequence_length])
            y.append(target[i + self.sequence_length])
            
        return np.array(X), np.array(y)

    def fit(self, train_df: pd.DataFrame, target_col: str = 'Close'):
        """
        Trains the LSTM model.
        """
        logger.info(f"Training AstroLSTM on {self.device}...")
        
        # Prepare Data with Scaling
        X_numpy, y_numpy = self._create_sequences(train_df, target_col, fit_scaler=True)
        
        # Convert to Tensors
        X_tensor = torch.FloatTensor(X_numpy).to(self.device)
        y_tensor = torch.FloatTensor(y_numpy).to(self.device)
        
        dataset = TensorDataset(X_tensor, y_tensor)
        loader = DataLoader(dataset, batch_size=32, shuffle=True)
        
        # Initialize Model
        input_dim = X_numpy.shape[2]
        self.model = LSTMModel(input_dim, self.hidden_dim, 1, self.n_layers).to(self.device)
        optimizer = optim.Adam(self.model.parameters(), lr=self.learning_rate)
        
        # Training Loop
        self.model.train()
        for epoch in range(self.epochs):
            total_loss = 0
            for batch_X, batch_y in loader:
                optimizer.zero_grad()
                outputs = self.model(batch_X)
                loss = self.criterion(outputs.squeeze(), batch_y)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
            
            if (epoch + 1) % 5 == 0:
                logger.info(f"Epoch [{epoch+1}/{self.epochs}], Loss: {total_loss/len(loader):.4f}")
                
        logger.success("AstroLSTM Training Completed.")
        return self

    def predict(self, test_df: pd.DataFrame, target_col: str = 'Close') -> np.ndarray:
        """
        Predicts using the trained model.
        """
        if self.model is None:
            raise ValueError("Model is not trained.")
            
        self.model.eval()
        X_numpy, _ = self._create_sequences(test_df, target_col, fit_scaler=False) 
        X_tensor = torch.FloatTensor(X_numpy).to(self.device)
        
        with torch.no_grad():
            preds_scaled = self.model(X_tensor).cpu().numpy()
            
        # Inverse transform
        preds = self.scaler_y.inverse_transform(preds_scaled).flatten()
        return preds

    def save(self, path: str):
        if self.model is None:
            logger.warning("No model to save.")
            return
        
        checkpoint = {
            'model_state_dict': self.model.state_dict(),
            'config': {
                'sequence_length': self.sequence_length,
                'hidden_dim': self.hidden_dim,
                'n_layers': self.n_layers
            }
        }
        torch.save(checkpoint, path)
        logger.info(f"AstroLSTM saved to {path}")

    def load(self, path: str, input_dim: int):
        checkpoint = torch.load(path)
        config = checkpoint['config']
        
        self.sequence_length = config['sequence_length']
        self.hidden_dim = config['hidden_dim'] 
        self.n_layers = config['n_layers']
        
        self.model = LSTMModel(input_dim, self.hidden_dim, 1, self.n_layers).to(self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()
        logger.info(f"AstroLSTM loaded from {path}")

class NeuralHMM(nn.Module):
    """
    LSTM-based classifier to predict next day's Market Regime (Hybrid approach).
    """
    def __init__(self, input_dim: int, hidden_dim: int, num_regimes: int, n_layers: int = 2, dropout: float = 0.2):
        super(NeuralHMM, self).__init__()
        self.lstm = nn.LSTM(input_dim, hidden_dim, n_layers, batch_first=True, dropout=dropout)
        self.fc = nn.Linear(hidden_dim, num_regimes)
        
    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

class NeuralHMMWrapper:
    """
    Wrapper for NeuralHMM Classifier.
    """
    def __init__(self, sequence_length: int = 10, hidden_dim: int = 64, n_layers: int = 2, 
                 learning_rate: float = 0.001, epochs: int = 20, exclude_cols: List[str] = None):
        self.sequence_length = sequence_length
        self.hidden_dim = hidden_dim
        self.n_layers = n_layers
        self.learning_rate = learning_rate
        self.epochs = epochs
        self.exclude_cols = exclude_cols or []
        
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.criterion = nn.CrossEntropyLoss()
        self.scaler_X = StandardScaler()
        
    def fit(self, train_df: pd.DataFrame, target_col: str = 'Market_Regime'):
        logger.info(f"Training NeuralHMM Classifier on {self.device}...")
        self.target_col = target_col
        
        # Prepare Data
        drop_cols = [target_col] + [c for c in self.exclude_cols if c in train_df.columns]
        features_df = train_df.drop(columns=drop_cols)
        target_series = train_df[target_col].values
        
        self.feature_names = features_df.columns.tolist()
        logger.info(f"Training with {len(self.feature_names)} features.")
        
        try:
            X_scaled = self.scaler_X.fit_transform(features_df)
            
            X, y = [], []
            for i in range(len(train_df) - self.sequence_length):
                X.append(X_scaled[i : i + self.sequence_length])
                y.append(target_series[i + self.sequence_length])
                
            X_tensor = torch.FloatTensor(np.array(X)).to(self.device)
            y_tensor = torch.LongTensor(np.array(y)).to(self.device)
            
            num_classes = len(np.unique(target_series))
            input_dim = X_tensor.shape[2]
            
            self.model = NeuralHMM(input_dim, self.hidden_dim, num_classes, self.n_layers).to(self.device)
            optimizer = optim.Adam(self.model.parameters(), lr=self.learning_rate)
            
            self.model.train()
            dataset = TensorDataset(X_tensor, y_tensor)
            if len(dataset) == 0:
                logger.warning("Empty dataset for training")
                return self
                
            loader = DataLoader(dataset, batch_size=32, shuffle=True)
            
            for epoch in range(self.epochs):
                total_loss = 0
                for batch_X, batch_y in loader:
                    optimizer.zero_grad()
                    outputs = self.model(batch_X)
                    loss = self.criterion(outputs, batch_y)
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item()
        except Exception as e:
            logger.error(f"NeuralHMM Fit Error: {e}")
            import traceback
            with open('neural_error.log', 'w') as f:
                traceback.print_exc(file=f)
            raise e
                
        logger.success("NeuralHMM Training Completed.")
        return self
            


    def save(self, path: str):
        if self.model:
            torch.save(self.model.state_dict(), path)
            logger.info(f"NeuralHMM saved to {path}")

    def load(self, path: str, input_dim: int, num_classes: int):
        self.model = NeuralHMM(input_dim, self.hidden_dim, num_classes, self.n_layers).to(self.device)
        self.model.load_state_dict(torch.load(path, map_location=self.device))
        self.model.eval()
        logger.info(f"NeuralHMM loaded from {path}")

    def predict(self, test_df: pd.DataFrame, target_col: str = None) -> np.ndarray:
        if self.model is None:
            raise ValueError("Model is not trained.")
            
        self.model.eval()
        
        # Resolve target column: arg > saved > default
        tgt = target_col if target_col else getattr(self, 'target_col', 'Market_Regime')
        
        # Drop target if present
        if tgt in test_df.columns:
            features_df = test_df.drop(columns=[tgt])
        else:
            features_df = test_df
            
        # Align features
        if hasattr(self, 'feature_names'):
             features_df = features_df[self.feature_names]
        
        X_scaled = self.scaler_X.transform(features_df)
        
        X = []
        for i in range(len(test_df) - self.sequence_length):
            X.append(X_scaled[i : i + self.sequence_length])
            
        if not X:
            return np.array([])
            
        X_tensor = torch.FloatTensor(np.array(X)).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(X_tensor)
            _, predicted = torch.max(outputs.data, 1)
            
        return predicted.cpu().numpy()
