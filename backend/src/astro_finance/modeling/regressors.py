from sklearn.ensemble import RandomForestRegressor
from astro_finance.modeling.base import AstroModel

class RandomForestAstroModel(AstroModel):
    def __init__(self, config):
        super().__init__(config)
        self.model = RandomForestRegressor(
            n_estimators=config.get('n_estimators', 100),
            random_state=config.get('random_state', 42)
        )

    def train(self, X, y):
        self.model.fit(X, y)

    def predict(self, X):
        return self.model.predict(X)
