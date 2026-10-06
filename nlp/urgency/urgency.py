def detect_urgency(text: str, sentiment: str) -> str:
    """
    Determines the urgency of a complaint based on keywords and sentiment.
    """
    text_lower = text.lower()
    
    critical_keywords = ["police", "sue", "legal", "lawyer", "fraud", "scam", "emergency"]
    high_keywords = ["urgent", "immediately", "asap", "unacceptable", "terrible"]
    
    for word in critical_keywords:
        if word in text_lower:
            return "Critical"
            
    for word in high_keywords:
        if word in text_lower:
            return "High"
            
    if sentiment == "Negative":
        return "Medium"
        
    return "Low"
