import os
import subprocess

import numpy as np
import whisper

# Load the model lazily
_model = None
SAMPLE_RATE = 16000


def get_model():
    global _model
    if _model is None:
        # 'base' model is faster but less accurate, 'small' or 'medium' is better for prod
        print("Loading Whisper model...")
        _model = whisper.load_model("base")
    return _model


def _ffmpeg_exe():
    """System ffmpeg if installed, otherwise the portable binary from imageio-ffmpeg (no admin rights needed)."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def load_audio(path: str) -> np.ndarray:
    """Decode any audio file (webm/ogg/mp3/wav...) to 16 kHz mono float32, as Whisper expects."""
    cmd = [_ffmpeg_exe(), "-nostdin", "-threads", "0", "-i", path, "-f", "s16le", "-ac", "1", "-acodec", "pcm_s16le",
           "-ar", str(SAMPLE_RATE), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0


def transcribe_audio(audio_path: str, language: str = None) -> str:
    """
    Transcribes audio file to text using OpenAI Whisper.
    """
    if not os.path.exists(audio_path):
        return ""

    model = get_model()
    options = {"fp16": False}
    if language:
        options["language"] = language
    result = model.transcribe(load_audio(audio_path), **options)
    return result["text"].strip()
