import hydra
from omegaconf import DictConfig
from astro_finance.common.logger import configure_logger
from astro_finance.core.dag import Pipeline, Task
from astro_finance.data.ingest import DataIngestor
from astro_finance.features.engineering import FeatureEngineer
from astro_finance.modeling.regressors import RandomForestAstroModel
import pandas as pd
import os

logger = configure_logger()

@hydra.main(version_base="1.3", config_path="../../config", config_name="main")
def main(cfg: DictConfig):
    """
    Main entrypoint for Astro Finance Pipeline.
    """
    logger.info(f"Starting {cfg.app.name}...")
    
    # Initialize components
    ingestor = DataIngestor(raw_dir=cfg.data.raw_dir)
    fe = FeatureEngineer()
    
    # Define tasks
    def task_load_planets():
        return ingestor.get_planetary_positions(cfg.data.start_date, cfg.data.end_date)
    
    def task_load_stocks():
        return ingestor.fetch_stock_data(cfg.data.stock_ticker, cfg.data.start_date, cfg.data.end_date)

    def task_load_events():
        events = []
        planets = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu']
        event_types = ['Rashi', 'Nakshatra']
        for p in planets:
            for et in event_types:
                df = ingestor.load_drik_events(p, et)
                if df is not None:
                    events.append(df)
        return events
    
    def task_process(planets_df, stock_df, event_dfs):
        return fe.merge_data(planets_df, stock_df, event_dfs)
    
    def task_train(data):
        X = data.drop(columns=['Close'])
        y = data['Close']
        model = RandomForestAstroModel(cfg.model)
        model.train(X, y)
        model_path = os.path.join(cfg.data.processed_dir, "model.joblib")
        model.save(model_path)
        logger.success(f"Model trained and saved to {model_path}")
        return model

    # Execution (Linear for PoC)
    p_df = task_load_planets()
    s_df = task_load_stocks()
    e_dfs = task_load_events()
    merged_df = task_process(p_df, s_df, e_dfs)
    
    # Save processed data
    output_file = os.path.join(cfg.data.processed_dir, "merged_data.csv")
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    merged_df.to_csv(output_file)
    logger.info(f"Saved merged data to {output_file}")
    
    task_train(merged_df)

if __name__ == "__main__":
    main()
