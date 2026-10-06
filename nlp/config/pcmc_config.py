import json
import os

# Shared PCMC reference data (zones, departments, routing) also used by the backend and frontend.
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "config", "pcmc.json")

with open(_CONFIG_PATH, encoding="utf-8") as f:
    PCMC = json.load(f)

WARD_TO_ZONE = {ward: zone for zone, info in PCMC["zones"].items() for ward in info["wards"]}
