import re

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

# Initialize engines
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# Keep in sync with backend/services/piiRedaction.js.
# Localities, pincodes, ward numbers, dates, durations and vehicle plates are intentionally kept:
# the classifier, NER and ward routing downstream depend on them.
_NAME_STOP_WORDS = r"hai|he|aahe|ahe|and|from|near|at|in|resident|living|staying|here|speaking"
_LATIN_NAME = rf"[A-Za-z][A-Za-z.'-]+(?:\s+(?!(?:{_NAME_STOP_WORDS})\b)[A-Za-z][A-Za-z.'-]+){{0,2}}"
_DEVANAGARI_NAME = r"[ऀ-ॿ]+(?:\s+(?!(?:है|आहे)(?![ऀ-ॿ]))[ऀ-ॿ]+)?"

_NAME = object()

# Order matters: longer and more specific identifiers run first so shorter rules cannot split them.
_REDACTION_RULES = [
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "<EMAIL_ADDRESS>"),
    (re.compile(r"(?<![\d-])(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{5})(?![\d-])"), "<CREDIT_CARD>"),
    (re.compile(r"(?<![\d-])\d{4}([ -]?)\d{4}\1\d{4}(?![\d-])"), "<GOVERNMENT_ID>"),
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b", re.I), "<GOVERNMENT_ID>"),
    (re.compile(r"(?<![\d+])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"), "<PHONE_NUMBER>"),
    (re.compile(r"(?<![\d+])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{2}[\s-]\d{3}[\s-]\d{4}(?!\d)"), "<PHONE_NUMBER>"),
    (re.compile(r"(?<![\d+])(?:(?:\+|00)?91[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)"), "<PHONE_NUMBER>"),
    (re.compile(rf"\b(my name is|name\s*[:-]|mera naam|mera nam|maza nav|majha nav|maze nav)\s+({_LATIN_NAME})", re.I), _NAME),
    (re.compile(rf"(मेरा नाम है|मेरा नाम|माझे नाव|माझं नाव|नाम\s*[:-])\s*({_DEVANAGARI_NAME})"), _NAME),
]


def _to_ascii_digits(text: str) -> str:
    return re.sub(r"[०-९]", lambda m: str(ord(m.group()) - 0x0966), text)


def _redact_name(match: re.Match) -> str:
    # The first word after the cue is the name; later Latin words count only when capitalised.
    cue, words = match.group(1), match.group(2).split()
    taken = 1
    while taken < len(words) and not re.match(r"[a-z]", words[taken]):
        taken += 1
    rest = " ".join(words[taken:])
    return f"{cue} <PERSON>" + (f" {rest}" if rest else "")


def redact_pii(text: str, language: str = 'en') -> str:
    """
    Redacts Personally Identifiable Information (PII) from the given text.
    """
    if not text:
        return text

    text = _to_ascii_digits(text)

    # "PERSON" is not requested because Presidio's English NER model flags Hinglish words as people;
    # names are handled by the cue-phrase rules below instead.
    results = analyzer.analyze(text=text, entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "CREDIT_CARD"], language=language)
    text = anonymizer.anonymize(text=text, analyzer_results=results).text

    for pattern, replacement in _REDACTION_RULES:
        text = pattern.sub(_redact_name if replacement is _NAME else replacement, text)

    return re.sub(r"<PERSON>(\s+<PERSON>)+", "<PERSON>", text)
