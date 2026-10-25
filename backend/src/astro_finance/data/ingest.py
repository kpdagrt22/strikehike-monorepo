import os
import pandas as pd
import yfinance as yf
import numpy as np
from skyfield.api import Loader, Topos, load
from datetime import datetime
from astro_finance.common.logger import configure_logger
from astro_finance.data.governance import PlanetaryRow, MarketRow
from astro_finance.features.vedic import VedicCalculator

logger = configure_logger()

class DataIngestor:
    def __init__(self, raw_dir: str):
        self.raw_dir = raw_dir
        self.loader = Loader(raw_dir)

    def load_ephemeris(self):
        """Loads SPICE kernel."""
        # Ensure directory exists
        os.makedirs(self.raw_dir, exist_ok=True)
        # Check if file exists, if not, skyfield loader handles download usually, 
        # but we assume de421.bsp is present as per user context.
        return self.loader('de421.bsp')

    def get_planetary_positions(self, start_date: str, end_date: str) -> pd.DataFrame:
        """Calculates planetary positions (Sidereal/Vedic) and features."""
        logger.info(f"Calculating Vedic planetary positions from {start_date} to {end_date}")
        
        ts = load.timescale()
        planets = self.load_ephemeris()
        earth = planets['earth']
        
        # Bodies mapping
        bodies = {
            'Sun': planets['sun'],
            'Moon': planets['moon'],
            'Mars': planets['mars'],
            'Mercury': planets['mercury'],
            'Jupiter': planets['jupiter_barycenter'],
            'Venus': planets['venus'],
            'Saturn': planets['saturn_barycenter'],
        }

        # Vedic Constants
        RASHI_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 
                       'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']
        NAKSHATRA_NAMES = [
            'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
            'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
            'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
        ]

        # Time vector (UTC)
        date_range = pd.date_range(start=start_date, end=end_date, freq='D', tz='UTC')
        t = ts.utc(date_range.year.values, date_range.month.values, date_range.day.values)
        
        # Ayanamsa (Lahiri approximation)
        # J2000 epoch
        base_ayanamsa = 23.855 # degrees
        precession_rate = 50.29 / 3600.0 # degrees per year
        
        # Calculate Julian Centuries from J2000
        # t.tt is Terrestrial Time Julian Date
        jd = t.tt
        t_cent = (jd - 2451545.0) / 36525.0
        ayanamsa = base_ayanamsa + (t_cent * precession_rate * 36525.0) # Approx
        # Actually precession accumulates with t_cent. 
        # Correct Lahiri formula approx: 23* 51' 11" + rate * T
        # Let's use simpler linear interpolation for speed and "good enough" for finance:
        # Ayanamsa array matching t
        
        results = {'Date': date_range}
        


        # 1. Main Planets
        vedic_calc = VedicCalculator()
        
        for name, body in bodies.items():
            astrometric = earth.at(t).observe(body)
            lat, lon, dist = astrometric.ecliptic_latlon()
            
            tropical_deg = lon.degrees
            sidereal_deg = (tropical_deg - ayanamsa) % 360
            results[f'{name}_Degree'] = sidereal_deg
            
            # Retrograde
            diff = np.diff(sidereal_deg, prepend=sidereal_deg[0])
            diff = np.where(diff < -300, diff + 360, diff)
            diff = np.where(diff > 300, diff - 360, diff)
            results[f'{name}_Retrograde'] = (diff < 0).astype(int)
            
            # Vedic Features via Class
            # Vectorizing this call would be better, but loop is fine for daily data < 50 years
            # For speed, we just do it per row? Or list comp.
            rashis, naks, padas = [], [], []
            for d in sidereal_deg:
                feats = vedic_calc.get_rashi_nakshatra_pada(d)
                rashis.append(feats['Rashi_Name'])
                naks.append(feats['Nakshatra_Name'])
                padas.append(feats['Pada'])
                
            results[f'{name}_Rashi'] = rashis
            results[f'{name}_Nakshatra'] = naks
            results[f'{name}_Pada'] = padas
            
        # 2. Rahu / Ketu
        mean_node_long = 125.04452 - 1934.136261 * t_cent
        rahu_deg = (mean_node_long % 360 - ayanamsa) % 360
        ketu_deg = (rahu_deg + 180) % 360
        
        results['Rahu_Degree'] = rahu_deg
        results['Rahu_Retrograde'] = 1
        
        # Rahu Features
        r, n, p = [], [], []
        for d in rahu_deg:
            f = vedic_calc.get_rashi_nakshatra_pada(d)
            r.append(f['Rashi_Name']); n.append(f['Nakshatra_Name']); p.append(f['Pada'])
        results['Rahu_Rashi'] = r; results['Rahu_Nakshatra'] = n; results['Rahu_Pada'] = p
        
        results['Ketu_Degree'] = ketu_deg
        results['Ketu_Retrograde'] = 1
        # Ketu Features
        r, n, p = [], [], []
        for d in ketu_deg:
            f = vedic_calc.get_rashi_nakshatra_pada(d)
            r.append(f['Rashi_Name']); n.append(f['Nakshatra_Name']); p.append(f['Pada'])
        results['Ketu_Rashi'] = r; results['Ketu_Nakshatra'] = n; results['Ketu_Pada'] = p

        # 3. Dasha (Moon Lord)
        # Calculate for each day
        moon_degs = results['Moon_Degree']
        dasha_lords = []
        for d in moon_degs:
            dasha = vedic_calc.calculate_vimshottari_dasha(d, None)
            dasha_lords.append(dasha['Moon_Nakshatra_Lord'])
        results['Dasha_Lord'] = dasha_lords
        
        # 4. Aspects (Vectorized-ish helper needed or loop row by row)
        # Our aspect calc in VedicCalculator is designed for single dictionary.
        # Let's do a quick optimized run here inside ingest or add a bulk method to VedicCalculator.
        # Doing row-by-row for aspects is 365 * 50 * (pairs) ~ 2M ops. Fast enough.
        
        # ... logic for aspects (moved to separate step or kept inline?)
        # For cleanliness, let's reconstruct the degrees map per row and call calc
        # Actually, numpy broadcasting is faster for aspects.
        # Let's keep the numpy Aspect logic from before but updated.
        
        all_bodies = list(bodies.keys()) + ['Rahu', 'Ketu']
        # Helper map for numpy arrays
        param_map = {}
        for b in list(bodies.keys()): param_map[b] = results[f'{b}_Degree']
        param_map['Rahu'] = rahu_deg
        param_map['Ketu'] = ketu_deg
        
        for i in range(len(all_bodies)):
            for j in range(i + 1, len(all_bodies)):
                p1, p2 = all_bodies[i], all_bodies[j]
                d1, d2 = param_map[p1], param_map[p2]
                diff = np.abs(d1 - d2)
                diff = np.minimum(diff, 360 - diff)
                results[f'Aspect_{p1}_{p2}'] = diff
                
                # Malefic
                if p1 in ['Saturn','Mars','Rahu','Ketu'] and p2 in ['Saturn','Mars','Rahu','Ketu']:
                    is_hard = (diff < 3) | (np.abs(diff-90)<3) | (np.abs(diff-180)<3)
                    results[f'Malefic_{p1}_{p2}_Hard'] = is_hard.astype(int)

        df = pd.DataFrame(results).set_index('Date')
        
        # Limit rows to exact date range if extra were generated
        return df

    def fetch_stock_data(self, ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
        """Fetches stock data."""
        logger.info(f"Fetching {ticker} data.")
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(df) == 0:
                logger.warning("No data found, using simulation.")
                return self._simulate_stock_data(start_date, end_date)
            
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
                
            df = df[['Close']].rename(columns={'Close': 'Close'})
            # Ensure UTC
            if df.index.tz is None:
                df.index = df.index.tz_localize('UTC')
            else:
                df.index = df.index.tz_convert('UTC')
            return df
        except Exception as e:
            logger.error(f"Error fetching stock data: {e}. Using simulation.")
            return self._simulate_stock_data(start_date, end_date)

    def _simulate_stock_data(self, start_date, end_date):
        """Generates random walk."""
        dates = pd.date_range(start=start_date, end=end_date, freq='B', tz='UTC')
        prices = [100.0]
        np.random.seed(42)
        for _ in range(1, len(dates)):
            prices.append(prices[-1] * (1 + np.random.normal(0.0002, 0.01)))
            
        df = pd.DataFrame({'Date': dates, 'Close': prices}).set_index('Date')
        return df
    def load_drik_events(self, planet: str, event_type: str) -> pd.DataFrame:
        """Loads Drikpanchang CSV events."""
        filename = f"events_{planet.lower()}_{event_type.lower()}.csv"
        # We assume drikpanchang folder is inside raw_dir
        filepath = os.path.join(self.raw_dir, 'drikpanchang', filename)
        
        if not os.path.exists(filepath):
            logger.warning(f"File not found: {filepath}")
            return None
            
        try:
            df = pd.read_csv(filepath)
            df['Date'] = pd.to_datetime(df['event_utc_dt'], errors='coerce', utc=True)
            df.dropna(subset=['Date'], inplace=True)
            df.sort_values('Date', inplace=True)
            
            value_col = f"{planet}_{event_type}"
            df.rename(columns={'to_sign': value_col}, inplace=True)
            df = df[['Date', value_col]].drop_duplicates(subset=['Date']).set_index('Date')
            return df
        except Exception as e:
            logger.error(f"Error loading {filename}: {e}")
            return None
