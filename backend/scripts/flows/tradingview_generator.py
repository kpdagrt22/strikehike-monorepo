"""
TradingView PineScript Generator Flow
======================================
Prefect flow for auto-generating downloadable TradingView indicators.
"""

import sys
from pathlib import Path
import json

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(BASE_DIR / "src"))
sys.path.append(str(BASE_DIR))

import pandas as pd
from prefect import flow, task
from loguru import logger

from config.settings import BASE_DIR


@task
def load_recent_signals(threshold: float = 0.8, limit: int = 20) -> pd.DataFrame:
    """Load high-confidence predictions from track record."""
    track_record_path = BASE_DIR / "web" / "public" / "track_record.json"
    
    if not track_record_path.exists():
        logger.warning("Track record not found. No signals to export.")
        return pd.DataFrame()
    
    with open(track_record_path, 'r') as f:
        track_record = json.load(f)
    
    predictions = track_record.get("predictions", [])
    
    if not predictions:
        logger.warning("No predictions in track record.")
        return pd.DataFrame()
    
    # Convert to DataFrame
    df = pd.DataFrame(predictions)
    df['date'] = pd.to_datetime(df['date'])
    
    # Filter high-confidence signals
    if 'regime_confidence' in df.columns:
        df = df[df['regime_confidence'] >= threshold]
    
    # Sort by date and limit
    df = df.sort_values('date', ascending=False).head(limit)
    
    logger.info(f"Loaded {len(df)} high-confidence signals (threshold: {threshold}).")
    return df


@task
def generate_pinescript(signals_df: pd.DataFrame) -> str:
    """Generate PineScript code with hardcoded signal labels."""
    
    if signals_df.empty:
        logger.warning("No signals to generate script for.")
        return ""
    
    # PineScript header
    script_header = f'''//@version=5
indicator("Astro Finance ML Signals", overlay=true)

// Auto-generated on {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M UTC')}
// ML Predictions with confidence >= 0.8
// Total signals: {len(signals_df)}

'''
    
    # Generate signal definitions
    script_body = ""
    for idx, row in signals_df.iterrows():
        ts = row['date']
        regime = row.get('market_regime', 'Unknown')
        confidence = row.get('regime_confidence', 0.0)
        
        # Color based on regime
        if regime == "Bull":
            color = "color.green"
            style = "label.style_label_up"
        elif regime == "Bear":
            color = "color.red"
            style = "label.style_label_down"
        else:
            color = "color.orange"
            style = "label.style_label_center"
        
        # Variable name (sanitize date)
        var_name = f"signal_{ts.strftime('%Y_%m_%d')}"
        
        script_body += f'''
// {regime} signal on {ts.strftime('%Y-%m-%d')}
{var_name} = timestamp({ts.year}, {ts.month}, {ts.day}, 0, 0, 0)
if time == {var_name}
    label.new(bar_index, high, "{regime}\\n({confidence:.0%})", style={style}, color={color}, textcolor=color.white, size=size.small)
'''
    
    full_script = script_header + script_body
    
    logger.success(f"Generated PineScript with {len(signals_df)} signals.")
    return full_script


@task
def publish_to_web(script_content: str):
    """Save PineScript to web/public for user download."""
    if not script_content:
        logger.warning("Empty script. Skipping publish.")
        return
    
    output_path = BASE_DIR / "web" / "public" / "astro_signal.pine"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(script_content)
    
    logger.success(f"Published PineScript to {output_path}")
    logger.info("Download URL: http://localhost:3000/astro_signal.pine")


@flow(name="TradingView Script Generator", log_prints=True)
def tradingview_script_generator(confidence_threshold: float = 0.8, max_signals: int = 20):
    """
    Daily flow: Generate downloadable PineScript indicator.
    Scheduled to run at 01:00 UTC (after inference).
    """
    logger.info("="*50)
    logger.info("TRADINGVIEW SCRIPT GENERATOR FLOW")
    logger.info("="*50)
    
    # Step 1: Load high-confidence signals
    signals = load_recent_signals(threshold=confidence_threshold, limit=max_signals)
    
    # Step 2: Generate PineScript
    script = generate_pinescript(signals)
    
    # Step 3: Publish
    publish_to_web(script)
    
    logger.success(f"✅ COMPLETE: Generated script with {len(signals)} signals.")
    return {"signals_count": len(signals), "status": "success"}


if __name__ == "__main__":
    # Test run
    result = tradingview_script_generator()
    print(result)
