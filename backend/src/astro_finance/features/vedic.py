import numpy as np
import pandas as pd
from typing import Dict, List, Tuple
from loguru import logger

class VedicCalculator:
    """
    Centralized logic for Vedic Astrology Calculations.
    Includes: Sidereal conversion, Rashi, Nakshatra, Pada, Aspects, and Dasha.
    """
    
    RASHI_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 
                   'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']
                   
    NAKSHATRA_NAMES = [
        'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
        'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
        'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
    ]
    
    # Vimshottari Dasha Lords in order (Ket, Ven, ... from Ashwini?)
    # Ashwini is Ketu. 
    # Order: Ketu, Venus, Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury
    DASHA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']
    
    # Dasha Duration in Years
    DASHA_YEARS = {
        'Ketu': 7, 'Venus': 20, 'Sun': 6, 'Moon': 10, 'Mars': 7, 
        'Rahu': 18, 'Jupiter': 16, 'Saturn': 19, 'Mercury': 17
    }
    
    def __init__(self):
        pass

    @staticmethod
    def get_rashi_nakshatra_pada(degree: float) -> Dict[str, any]:
        """Calculates Rashi, Nakshatra (index & name), and Pada for a given degree (0-360)."""
        deg = degree % 360
        
        # Rashi
        rashi_idx = int(deg / 30.0)
        
        # Nakshatra (13 deg 20 min = 13.333...)
        nak_raw = deg / 13.333333333
        nak_idx = int(nak_raw)
        
        # Pada (4 per nakshatra)
        # Fraction of nakshatra * 4
        pada = int((nak_raw - nak_idx) * 4) + 1
        
        return {
            'Rashi_Id': rashi_idx,
            'Rashi_Name': VedicCalculator.RASHI_NAMES[rashi_idx],
            'Nakshatra_Id': nak_idx,
            'Nakshatra_Name': VedicCalculator.NAKSHATRA_NAMES[nak_idx % 27],
            'Pada': pada
        }

    @staticmethod
    def calculate_aspects(bodies_deg: Dict[str, float]) -> Dict[str, float]:
        """
        Calculates angular aspects between all bodies.
        Returns dictionary of 'Aspect_{p1}_{p2}': angle.
        """
        results = {}
        planets = list(bodies_deg.keys())
        
        for i in range(len(planets)):
            for j in range(i + 1, len(planets)):
                p1 = planets[i]
                p2 = planets[j]
                d1 = bodies_deg[p1]
                d2 = bodies_deg[p2]
                
                diff = abs(d1 - d2)
                diff = min(diff, 360 - diff)
                
                results[f'Aspect_{p1}_{p2}'] = diff
                
                # Malefic Checks (Saturn/Mars/Nodes involved in Hard Aspects)
                malefics = ['Saturn', 'Mars', 'Rahu', 'Ketu']
                if p1 in malefics and p2 in malefics:
                     # Orb 3 degrees
                    is_hard = (diff < 3) or (abs(diff - 90) < 3) or (abs(diff - 180) < 3)
                    results[f'Malefic_{p1}_{p2}_Hard'] = 1 if is_hard else 0
                    
        return results

    @staticmethod
    def calculate_vimshottari_dasha(moon_degree: float, current_date_dt) -> Dict[str, str]:
        """
        Calculates the CURRENT Mahadasha & Antardasha based on Moon's position.
        
        NOTE: In Mundane/Market astrology, 'Birth' Dasha is relative to the chart start.
        However, for a continuous time-series without a fixed 'Birth Date', this is tricky.
        
        OPTION A: Use the 'Universal Time' Dasha (Current Moon Nakshatra defines the 'ruling' energy).
        This essentially just maps Moon Nakshatra to a Planet.
        
        OPTION B: Calculate Dasha relative to a specific reference date (e.g. Asset IPO).
        
        For this implementation, let's return the "Ruling Planet" of the Moon's Nakshatra
        as the "Instantaneous Dasha Lord" which is often used in transit analysis.
        
        If the user wants predictive Dasha cycles (Time), we need an IPO date. 
        Assuming 'Instantaneous' for generic market features first.
        """
        
        # 1. Get Moon's Nakshatra
        deg = moon_degree % 360
        nak_raw = deg / 13.333333333
        nak_idx = int(nak_raw) # 0-26
        
        # 2. Map to Lord
        # Cycle repeats: Ketu, Venus, ... Mercury (9 planets)
        # Nakshatra 0 (Ashwini) -> Ketu
        # Nakshatra 1 (Bharani) -> Venus
        lord_idx = nak_idx % 9
        mahadasha_lord = VedicCalculator.DASHA_LORDS[lord_idx]
        
        # 3. Balance / Antardasha
        # The stored Dasha is usually calculated from the *fraction* traversed in the Nakshatra.
        # traversal = (nak_raw - nak_idx)  (0.0 to 1.0)
        # This fraction determines how much of the Mahadasha is *remaining* or *passed*.
        # For "Instantaneous" transit influence, knowing the Lord is the primary factor.
        
        return {
            'Moon_Nakshatra_Lord': mahadasha_lord
        }

    # Helper to full Dasha Table for a given birth date?
    # Leave for future if specifically requested for IPO-based charts.
