import re
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.pcmc_config import PCMC, WARD_TO_ZONE

# Locality -> prabhag (ward) number from config/pcmc.json. Empty until filled from PCMC's official
# ward-boundary list; we never guess which ward a locality belongs to.
LOCALITY_TO_WARD = {name.lower(): int(ward) for name, ward in PCMC["localities"].items()}

# "prabhag 13", "ward no. 13", "प्रभाग क्र. १३" (digits are ASCII by now: PII redaction normalises them).
_WARD_NUMBER = re.compile(
    r"(?:prabhag|ward|प्रभाग|वार्ड|वॉर्ड)\s*(?:no\.?|number|क्र\.?|क्रमांक|नं\.?)?\s*[:#.-]?\s*(\d{1,2})(?!\d)",
    re.IGNORECASE,
)

_LATIN_PATTERNS = [
    (name, re.compile(rf"(?<![a-z]){re.escape(name)}(?![a-z])"))
    for name in LOCALITY_TO_WARD if not re.search(r"[ऀ-ॿ]", name)
]
# Devanagari attaches suffixes ("चिंचवडमध्ये"), so only the start of the word is anchored.
_DEVANAGARI_PATTERNS = [
    (name, re.compile(rf"(?<![ऀ-ॿ]){re.escape(name)}"))
    for name in LOCALITY_TO_WARD if re.search(r"[ऀ-ॿ]", name)
]


def find_localities(text: str) -> list:
    """Configured localities in order of appearance (whole-word, English or Devanagari)."""
    text_lower = text.lower()
    hits = []
    for name, pattern in _LATIN_PATTERNS:
        match = pattern.search(text_lower)
        if match:
            hits.append((match.start(), name))
    for name, pattern in _DEVANAGARI_PATTERNS:
        match = pattern.search(text)
        if match:
            hits.append((match.start(), name))
    ordered = []
    for _, name in sorted(hits):
        if name not in ordered:
            ordered.append(name)
    return ordered


def determine_ward(text: str) -> dict:
    """
    Returns {"wardNumber": int | None, "zone": "A".."L" | None, "ward": display string}.
    An explicit ward number in the text wins; otherwise a configured locality is used.
    """
    ward_number = None
    match = _WARD_NUMBER.search(text)
    if match and int(match.group(1)) in WARD_TO_ZONE:
        ward_number = int(match.group(1))
    else:
        localities = find_localities(text)
        if localities:
            ward_number = LOCALITY_TO_WARD[localities[0]]

    if ward_number is None:
        return {"wardNumber": None, "zone": None, "ward": "Unknown Ward"}
    return {"wardNumber": ward_number, "zone": WARD_TO_ZONE[ward_number], "ward": f"Prabhag {ward_number}"}
