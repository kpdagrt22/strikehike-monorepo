"""
Incremental Data Ingestion Flow
================================
Prefect flow for daily delta appending of market + planetary data.
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(BASE_DIR / "src"))
sys.path.append(str(BASE_DIR))

import pandas as pd
import yfinance as yf
from prefect import flow, task
from prefect.tasks import task_input_hash
from loguru import logger

from config.settings import PROCESSED_DATA_PATH, BASE_DIR
# Note: Planetary features calculated inline or skip if module not available

# Cache model for 1 hour to avoid re-initialization
@task(cache_key_fn=task_input_hash, cache_expiration=timedelta(hours=1))
def get_last_date() -> pd.Timestamp:
    """Read the latest date from master dataset."""
    data_path = BASE_DIR / PROCESSED_DATA_PATH
    
    if not data_path.exists():
        logger.warning(f"Master data not found at {data_path}. Starting from scratch.")
        return pd.Timestamp('1992-01-01')
    
    # Try Parquet first, fallback to CSV
    if str(data_path).endswith('.parquet'):
        df = pd.read_parquet(data_path)
    else:
        df = pd.read_csv(data_path, index_col=0, parse_dates=True)
    
    last_date = df.index.max()
    logger.info(f"Last date in master: {last_date.date()}")
    return last_date


@task(retries=3, retry_delay_seconds=[10, 30, 60])
def fetch_market_delta(symbol: str, start_date: pd.Timestamp) -> pd.DataFrame:
    """Fetch new OHLCV data from Yahoo Finance."""
    today = pd.Timestamp.now(tz='UTC').normalize()
    
    # If start_date is today or newer, no new data
    if start_date >= today:
        logger.info("No new data available. Market data is up-to-date.")
        return pd.DataFrame()
    
    # Fetch from day after last date to today
    fetch_start = start_date + pd.Timedelta(days=1)
    logger.info(f"Fetching {symbol} from {fetch_start.date()} to {today.date()}...")
    
    try:
        delta_df = yf.download(symbol, start=fetch_start, end=today, progress=False)
        
        if delta_df.empty:
            logger.warning(f"No data returned from Yahoo Finance for {symbol}.")
            return pd.DataFrame()
        
        # Ensure timezone-naive index
        if delta_df.index.tz is not None:
            delta_df.index = delta_df.index.tz_localize(None)
        
        logger.success(f"Fetched {len(delta_df)} new trading days.")
        return delta_df
    
    except Exception as e:
        logger.error(f"Failed to fetch data: {e}")
        raise


@task
def calculate_features(delta_df: pd.DataFrame, lookback_window: int = 200) -> pd.DataFrame:
    """
    Calculate planetary + technical features for new data.
    Requires lookback buffer for rolling calculations (e.g., 200-day MA).
    """
    if delta_df.empty:
        return pd.DataFrame()
    
    data_path = BASE_DIR / PROCESSED_DATA_PATH
    
    # Load context (last N rows from existing data) for rolling features
    if data_path.exists():
        if str(data_path).endswith('.parquet'):
            existing_df = pd.read_parquet(data_path)
        else:
            existing_df = pd.read_csv(data_path, index_col=0, parse_dates=True)
        
        context = existing_df.tail(lookback_window)
        combined = pd.concat([context, delta_df])
    else:
        combined = delta_df
    
    logger.info(f"Computing features on {len(combined)} rows (including {lookback_window}-day context)...")
    
    # Calculate Returns and Volatility (basic features)
    combined['Returns'] = combined['Close'].pct_change()
    combined['Volatility'] = combined['Returns'].rolling(20).std()
    
    # TODO: Add planetary features via astro_finance.features module
    # For now, using basic technical features only
    
    # Market regime (K-Means clustering)
    from sklearn.cluster import KMeans
    features = combined[['Returns', 'Volatility']].dropna()
    if len(features) > 3:
        kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
        combined.loc[features.index, 'Market_Regime'] = kmeans.fit_predict(features)
    
    # Return only the NEW rows (exclude context)
    new_features = combined.tail(len(delta_df))
    logger.success(f"Features calculated for {len(new_features)} new rows.")
    
    return new_features


@task
def append_to_master(delta_features: pd.DataFrame) -> int:
    """Append new rows to master dataset (Parquet or CSV)."""
    if delta_features.empty:
        logger.info("No new data to append.")
        return 0
    
    data_path = BASE_DIR / PROCESSED_DATA_PATH
    
    # Load existing data
    if data_path.exists():
        if str(data_path).endswith('.parquet'):
            existing_df = pd.read_parquet(data_path)
        else:
            existing_df = pd.read_csv(data_path, index_col=0, parse_dates=True)
        
        # Concatenate
        updated_df = pd.concat([existing_df, delta_features])
    else:
        updated_df = delta_features
    
    # Remove duplicates (in case of re-runs)
    updated_df = updated_df[~updated_df.index.duplicated(keep='last')]
    
    # Save
    if str(data_path).endswith('.parquet'):
        updated_df.to_parquet(data_path)
    else:
        updated_df.to_csv(data_path)
    
    rows_added = len(delta_features)
    logger.success(f"Appended {rows_added} rows to {data_path}.")
    
    return rows_added


@flow(name="Incremental Data Ingestion", log_prints=True)
def incremental_data_ingestion(symbol: str = "SPY"):
    """
    Daily flow: Fetch only new market data and append to master dataset.
    Scheduled to run at 00:05 UTC daily.
    """
    logger.info("="*50)
    logger.info("INCREMENTAL DATA INGESTION FLOW")
    logger.info("="*50)
    
    # Step 1: Get last date
    last_date = get_last_date()
    
    # Step 2: Fetch delta
    delta_raw = fetch_market_delta(symbol, last_date)
    
    if delta_raw.empty:
        logger.info("✅ No new data. Exiting.")
        return {"rows_added": 0, "status": "up_to_date"}
    
    # Step 3: Calculate features
    delta_features = calculate_features(delta_raw, lookback_window=200)
    
    # Step 4: Append
    rows_added = append_to_master(delta_features)
    
    logger.success(f"✅ COMPLETE: Added {rows_added} new rows.")
    return {"rows_added": rows_added, "status": "success"}


if __name__ == "__main__":
    # Test run
    result = incremental_data_ingestion()
    print(result)
