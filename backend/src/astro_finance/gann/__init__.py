"""
Gann Theory Module for Financial Market Analysis

Implements W.D. Gann's geometric and mathematical methods for market timing:
- Gann Angles (1x1, 2x1, 3x1, 4x1, 8x1 etc.)
- Gann Square of 9
- Swing High/Low Detection
- Price-Time Relationships
"""

from .angles import GannAngleCalculator
from .square_of_nine import SquareOfNine
from .swing_detector import SwingDetector

__all__ = ['GannAngleCalculator', 'SquareOfNine', 'SwingDetector']
