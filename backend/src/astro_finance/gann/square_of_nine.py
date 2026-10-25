"""
Gann Square of 9

The Square of 9 is one of Gann's most famous tools for price and time analysis.
It's based on a spiral of numbers starting from 1 in the center.

Key concepts:
- Numbers spiral outward in a square pattern
- 90° angles connect numbers with harmonic relationships
- Cardinal points (0°, 90°, 180°, 270°) represent strong levels
- Diagonal angles (45°, 135°, 225°, 315°) also significant

Applications:
- Calculate price targets from a base price
- Identify support/resistance levels
- Time cycles (convert price to time and vice versa)
"""

import numpy as np
from typing import List, Tuple, Dict
from dataclasses import dataclass


@dataclass
class SquarePosition:
    """Position in the Square of 9."""
    number: float
    ring: int  # distance from center
    angle: float  # degrees from 0°
    
    
class SquareOfNine:
    """
    Implements W.D. Gann's Square of 9 calculator.
    
    The square spiral formula:
    - Ring 0 (center): 1
    - Ring 1: 2-9 (8 numbers)
    - Ring 2: 10-25 (16 numbers)
    - Each ring has a starting value and rotates 360°
    """
    
    # Important angles in the square
    CARDINAL_ANGLES = [0, 90, 180, 270]
    DIAGONAL_ANGLES = [45, 135, 225, 315]
    SIGNIFICANT_ANGLES = CARDINAL_ANGLES + DIAGONAL_ANGLES
    
    @staticmethod
    def price_to_square_root(price: float) -> float:
        """Convert price to square root for Square of 9."""
        return np.sqrt(price)
    
    @staticmethod
    def square_root_to_price(sqrt_value: float) -> float:
        """Convert square root back to price."""
        return sqrt_value ** 2
    
    def rotate_by_degrees(self, price: float, degrees: float) -> float:
        """
        Rotate a price by X degrees on the Square of 9.
        
        Since 360° in the square = 2 units in square root space:
        - 90° = 0.5 units
        - 180° = 1.0 units
        - 360° = 2.0 units
        
        Args:
            price: Starting price
            degrees: Degrees to rotate (positive = clockwise/up)
            
        Returns:
            New price level
        """
        sqrt_price = self.price_to_square_root(price)
        
        # Convert degrees to square root units
        # 360° = 2 units of square root
        sqrt_increment = (degrees / 360.0) * 2.0
        
        new_sqrt = sqrt_price + sqrt_increment
        new_price = self.square_root_to_price(new_sqrt)
        
        return new_price
    
    def calculate_targets(
        self, 
        base_price: float, 
        angles: List[float] = None
    ) -> Dict[float, float]:
        """
        Calculate price targets at significant angles from a base price.
        
        Args:
            base_price: Starting reference price
            angles: List of angles to calculate (default: significant angles)
            
        Returns:
            Dictionary mapping angle -> target price
        """
        if angles is None:
            angles = self.SIGNIFICANT_ANGLES
        
        targets = {}
        for angle in angles:
            targets[angle] = self.rotate_by_degrees(base_price, angle)
        
        return targets
    
    def calculate_resistance_levels(
        self, 
        base_price: float, 
        num_levels: int = 5
    ) -> List[float]:
        """
        Calculate resistance levels above current price.
        Using 90° increments (each 90° = strong resistance).
        
        Args:
            base_price: Current price
            num_levels: Number of resistance levels to calculate
            
        Returns:
            List of resistance prices
        """
        levels = []
        for i in range(1, num_levels + 1):
            # Each 90° up represents next resistance
            resistance = self.rotate_by_degrees(base_price, 90 * i)
            levels.append(resistance)
        
        return levels
    
    def calculate_support_levels(
        self, 
        base_price: float, 
        num_levels: int = 5
    ) -> List[float]:
        """
        Calculate support levels below current price.
        Using 90° decrements (downward rotation).
        
        Args:
            base_price: Current price
            num_levels: Number of support levels to calculate
            
        Returns:
            List of support prices
        """
        levels = []
        for i in range(1, num_levels + 1):
            # Each 90° down represents next support
            support = self.rotate_by_degrees(base_price, -90 * i)
            levels.append(support)
        
        return levels
    
    def find_nearest_square_value(self, price: float) -> int:
        """
        Find the nearest perfect square to a price.
        Useful for identifying key levels.
        """
        sqrt_val = np.sqrt(price)
        lower_square = int(sqrt_val) ** 2
        upper_square = (int(sqrt_val) + 1) ** 2
        
        if abs(price - lower_square) < abs(price - upper_square):
            return lower_square
        else:
            return upper_square
    
    def calculate_time_cycles(
        self, 
        start_date_number: int, 
        num_cycles: int = 5
    ) -> List[int]:
        """
        Calculate time cycles using Square of 9 applied to dates.
        
        Args:
            start_date_number: Starting point (e.g., days since epoch)
            num_cycles: Number of cycles to calculate
            
        Returns:
            List of significant time points
        """
        cycles = []
        
        # Common time harmonics: 90, 144, 180, 360 days
        harmonic_degrees = [90, 144, 180, 270, 360]
        
        for degree in harmonic_degrees[:num_cycles]:
            # Convert time using square relationship
            sqrt_time = np.sqrt(start_date_number)
            time_increment = (degree / 360.0) * 2.0
            future_sqrt_time = sqrt_time + time_increment
            future_time = int(future_sqrt_time ** 2)
            cycles.append(future_time)
        
        return cycles
    
    def get_price_angle(self, base_price: float, target_price: float) -> float:
        """
        Calculate the angle between two prices on the Square of 9.
        
        This helps identify harmonic relationships:
        - 90° = strong harmony
        - 180° = opposition
        - 45°, 135°, etc. = diagonal harmonics
        """
        base_sqrt = self.price_to_square_root(base_price)
        target_sqrt = self.price_to_square_root(target_price)
        
        sqrt_difference = target_sqrt - base_sqrt
        
        # Convert square root difference to degrees
        # 2 units = 360°
        degrees = (sqrt_difference / 2.0) * 360.0
        
        # Normalize to 0-360
        degrees = degrees % 360
        
        return degrees
    
    def is_harmonic_price(
        self, 
        base_price: float, 
        test_price: float, 
        tolerance_degrees: float = 5.0
    ) -> Tuple[bool, float]:
        """
        Check if test_price is at a harmonic angle to base_price.
        
        Args:
            base_price: Reference price
            test_price: Price to test
            tolerance_degrees: Acceptable deviation from exact angle
            
        Returns:
            (is_harmonic, actual_angle)
        """
        angle = self.get_price_angle(base_price, test_price)
        
        # Check if close to any significant angle
        for sig_angle in self.SIGNIFICANT_ANGLES:
            diff = abs(angle - sig_angle)
            # Handle wraparound
            diff = min(diff, 360 - diff)
            
            if diff <= tolerance_degrees:
                return (True, sig_angle)
        
        return (False, angle)
    
    def generate_square_grid(
        self, 
        center_price: float, 
        num_rings: int = 3
    ) -> Dict[int, List[float]]:
        """
        Generate a grid of prices in the Square of 9 pattern.
        
        Args:
            center_price: Center of the square
            num_rings: Number of concentric rings to generate
            
        Returns:
            Dictionary mapping ring_number -> list of prices in that ring
        """
        grid = {}
        sqrt_center = self.price_to_square_root(center_price)
        
        # Each ring moves out by 0.5 sqrt units and contains more values
        for ring in range(num_rings + 1):
            prices = []
            
            if ring == 0:
                # Center
                prices = [center_price]
            else:
                # Number of points in this ring (approximation)
                points_in_ring = 8 * ring
                
                for i in range(points_in_ring):
                    angle_degrees = (360.0 / points_in_ring) * i
                    sqrt_increment = (ring * 0.5)  # Each ring is 0.5 sqrt units out
                    
                    # Rotate from center
                    angle_sqrt_increment = (angle_degrees / 360.0) * 2.0
                    point_sqrt = sqrt_center + sqrt_increment + angle_sqrt_increment
                    point_price = self.square_root_to_price(point_sqrt)
                    
                    prices.append(round(point_price, 2))
            
            grid[ring] = prices
        
        return grid
