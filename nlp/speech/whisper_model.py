import whisper
import os

# Load the model lazily
_model = None

def get_model():
    global _model
    if _model is None:
        # 'base' model is faster but less accurate, 'small' or 'medium' is better for prod
        print("Loading Whisper model...")
        _model = whisper.load_model("base") 
    return _model

def transcribe_audio(audio_path: str) -> str:
    """
    Transcribes audio file to text using OpenAI Whisper.
    """
    if not os.path.exists(audio_path):
        return ""
    
    model = get_model()
    result = model.transcribe(audio_path)
    return result["text"]
