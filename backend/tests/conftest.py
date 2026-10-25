import pytest
import pandas as pd
import numpy as np
from datetime import datetime

@pytest.fixture
def mock_planetary_data():
    dates = pd.date_range(start='2020-01-01', periods=5, freq='D')
    return pd.DataFrame({
        'Date': dates,
        'Sun_Degree': np.random.uniform(0, 360, 5),
        'Moon_Degree': np.random.uniform(0, 360, 5)
    }).set_index('Date')

@pytest.fixture
def mock_stock_data():
    dates = pd.date_range(start='2020-01-01', periods=5, freq='D')
    return pd.DataFrame({
        'Close': [100.0, 101.0, 102.0, 101.5, 103.0]
    }, index=dates)
