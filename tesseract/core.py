# tesseract/core.py

import math
from typing import Dict, Any

def pythagorean_alignment(duality_a: float, duality_b: float, resistance: float = 0.0) -> Dict[str, Any]:
    unity_score = (duality_a ** 2 + duality_b ** 2) ** 0.5
    unity_normalized = min(100, max(0, (unity_score / 10) * 100))
    phoenix_trigger = unity_normalized < 35
    return {
        "unity_score": round(unity_normalized, 2),
        "phoenix_trigger": phoenix_trigger,
        "resistance_level": resistance,
        "recommendation": "Initiate Phoenix Protocol" if phoenix_trigger else "Maintain Harmony"
    }

def golden_harmony_score(value: float, ideal: float) -> float:
    PHI = (1 + math.sqrt(5)) / 2
    ratio = value / ideal if ideal != 0 else 0
    deviation = abs(ratio - PHI)
    score = max(0, 100 - (deviation * 100))
    return round(score, 2)

def process_user_input(user_input: str, mode: str = "normal") -> Dict[str, Any]:
    # Simple resistance detection (you can make this smarter later)
    resistance = len(user_input) * 0.8  # placeholder logic
    
    # Example duality values (you'll replace with real detection later)
    duality_a = 6.5
    duality_b = 5.2
    
    alignment = pythagorean_alignment(duality_a, duality_b, resistance)
    
    return {
        "input": user_input,
        "mode": mode,
        "alignment": alignment,
        "golden_score": golden_harmony_score(resistance, 50)
    }
