from transformers import pipeline

_sentiment_pipeline = None

def get_sentiment_pipeline():
    global _sentiment_pipeline
    if _sentiment_pipeline is None:
        print("Loading Sentiment model...")
        # Using a multilingual sentiment model
        _sentiment_pipeline = pipeline("sentiment-analysis", model="nlptown/bert-base-multilingual-uncased-sentiment")
    return _sentiment_pipeline

def analyze_sentiment(text: str) -> str:
    """
    Analyzes sentiment of the text and maps it to Positive, Neutral, or Negative.
    """
    if not text:
        return "Neutral"
        
    try:
        classifier = get_sentiment_pipeline()
        result = classifier(text)[0]
        # nlptown model returns 1 to 5 stars
        label = result['label']
        stars = int(label.split(' ')[0])
        
        if stars <= 2:
            return "Negative"
        elif stars == 3:
            return "Neutral"
        else:
            return "Positive"
    except Exception as e:
        print(f"Sentiment error: {e}")
        return "Neutral"
