import re
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from routing.ward_mapping import find_localities

def extract_entities(text: str) -> dict:
    """
    Extracts Location, Locality, and Duration from text.
    """
    entities = {}
    text_lower = text.lower()
    
    # 1. Extract Locality (based on known areas)
    localities_found = [locality.title() for locality in find_localities(text)]
    
    if localities_found:
        entities['locality'] = localities_found[0] # Take the first found
        entities['location'] = localities_found[0]
        
    # 2. Extract Duration (e.g. "3 days", "for 2 months")
    duration_match = re.search(r'\b(\d+)\s*(days?|months?|weeks?|hours?|yrs|years?)\b', text_lower)
    if duration_match:
        entities['issueDuration'] = duration_match.group(0)
        
    # 3. Extract Pin code (Pimpri-Chinchwad uses 4110xx and, in outer areas like Moshi/Chikhli, 4121xx)
    pincode_match = re.search(r'\b(?:4110|4121)\d{2}\b', text_lower)
    if pincode_match:
        entities['pincode'] = pincode_match.group(0)
        
    return entities
