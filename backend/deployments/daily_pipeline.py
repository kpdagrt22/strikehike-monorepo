# File for Prefect to track deployments

from prefect.deployments import Deployment
from prefect.server.schemas.schedules import CronSchedule

from scripts.flows.data_ingestion import incremental_data_ingestion
from scripts.flows.model_inference import daily_model_inference
from scripts.flows.tradingview_generator import tradingview_script_generator

# Deployment 1: Daily Data Ingestion (00:05 UTC)
data_deployment = Deployment.build_from_flow(
    flow=incremental_data_ingestion,
    name="daily-data-ingest",
    version="1.0",
    tags=["production", "data-pipeline", "incremental"],
    description="Incremental market data ingestion from Yahoo Finance + planetary feature calculation",
    schedule=CronSchedule(cron="5 0 * * *", timezone="UTC"),
    parameters={"symbol": "SPY"}
)

# Deployment 2: Daily Model Inference (00:30 UTC)
inference_deployment = Deployment.build_from_flow(
    flow=daily_model_inference,
    name="daily-inference",
    version="1.0",
    tags=["production", "ml-pipeline", "inference"],
    description="Daily ML predictions using NeuralHMM + XGBoost",
    schedule=CronSchedule(cron="30 0 * * *", timezone="UTC")
)

# Deployment 3: TradingView Export (01:00 UTC)
tradingview_deployment = Deployment.build_from_flow(
    flow=tradingview_script_generator,
    name="tradingview-export",
    version="1.0",
    tags=["production", "tradingview", "export"],
    description="Generate downloadable PineScript indicator with ML signals",
    schedule=CronSchedule(cron="0 1 * * *", timezone="UTC"),
    parameters={"confidence_threshold": 0.8, "max_signals": 20}
)

if __name__ == "__main__":
    # Apply all deployments
    data_deployment.apply()
    print("✅ Deployed: daily-data-ingest")
    
    inference_deployment.apply()
    print("✅ Deployed: daily-inference")
    
    tradingview_deployment.apply()
    print("✅ Deployed: tradingview-export")
    
    print("\n🚀 All deployments created successfully!")
    print("Start a Prefect agent with: prefect agent start default")
