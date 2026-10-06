import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_config import PCMC


def determine_priority_and_department(category: str, urgency: str) -> tuple:
    """
    Returns (priority, department) based on category and urgency.
    Priority levels: P1 (Critical), P2 (High), P3 (Medium), P4 (Low)
    """
    priority = {"Critical": "P1", "High": "P2", "Medium": "P3"}.get(urgency, "P4")

    # PCMC department routing lives in config/pcmc.json so it can be corrected without code changes.
    route = PCMC["categoryRouting"].get(category)
    department = route["department"] if route else PCMC["defaultDepartment"]

    return priority, department
