from abc import ABC, abstractmethod
import pandas as pd
import joblib
import os

class AstroModel(ABC):
    def __init__(self, config):
        self.config = config
        self.model = None

    @abstractmethod
    def train(self, X: pd.DataFrame, y: pd.Series):
        pass

    @abstractmethod
    def predict(self, X: pd.DataFrame) -> pd.Series:
        pass

    def save(self, path: str):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump(self.model, path)
        
    def load(self, path: str):
        self.model = joblib.load(path)
