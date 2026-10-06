import logging
import re

from langdetect import detect_langs

logger = logging.getLogger(__name__)

# The app supports English, Hindi, Marathi and Hinglish; these word lists separate them reliably
# where langdetect alone confuses Marathi/Hindi/Nepali and labels Hinglish as Indonesian, Somali, etc.
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
MARATHI_MARKERS = {"आहे", "आहेत", "मध्ये", "नाही", "आणि", "पासून", "झाला", "झाले", "होत", "आम्ही", "माझा", "माझे", "येथे", "केले", "करा", "कसा", "कसे", "कुठे", "काय", "भरायचा", "मिळेल"}
HINDI_MARKERS = {"है", "हैं", "में", "नहीं", "और", "से", "रहा", "रही", "हुआ", "हम", "मेरा", "मेरे", "यहाँ", "किया", "करें", "कैसे", "कहाँ", "क्या", "भरना", "मिलेगा"}
HINGLISH_MARKERS = {"hai", "hain", "nahi", "nahin", "kya", "kar", "karo", "mera", "meri", "mujhe", "raha", "rahi", "gaya", "gayi", "hua", "hui", "ke", "ki", "ka", "se", "mein", "pe", "aur", "bhi", "abhi", "koi", "yaha", "wahan", "din", "dino", "pass", "paas", "kaise", "kahan", "kaha", "bharu", "bharna", "chahiye", "milega"}
MARATHI_LATIN_MARKERS = {"kasa", "kase", "kuthe", "kay", "aahe", "ahe", "nahi", "bharaycha", "bharayche", "milel", "majha", "maza", "karaycha"}


def devanagari_language(text: str, detected: str = "") -> str:
    words = set(re.findall(r"[ऀ-ॿ]+", text))
    marathi, hindi = len(words & MARATHI_MARKERS), len(words & HINDI_MARKERS)
    if marathi != hindi:
        return "Marathi" if marathi > hindi else "Hindi"
    return "Marathi" if detected == "mr" else "Hindi"


def detect_language(text: str) -> str:
    """Returns "English", "Hindi", "Marathi", "Hinglish" or "Unknown"."""
    if not text or not text.strip():
        return "Unknown"
    try:
        if DEVANAGARI.search(text):
            try:
                detected = detect_langs(text)[0].lang
            except Exception:
                detected = ""
            return devanagari_language(text, detected)
        words = set(re.findall(r"[a-z]+", text.lower()))
        # Romanised Marathi ("property tax kasa bharaycha") is answered in Marathi.
        if len(words & MARATHI_LATIN_MARKERS - {"nahi"}) >= 1 and len(words & MARATHI_LATIN_MARKERS) > len(words & HINGLISH_MARKERS - {"nahi"}):
            return "Marathi"
        return "Hinglish" if len(words & HINGLISH_MARKERS) >= 2 else "English"
    except Exception as error:
        logger.error(f"Lang detect error: {error}")
        return "English"
