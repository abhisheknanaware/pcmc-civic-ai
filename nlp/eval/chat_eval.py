"""
Chatbot evaluation: intent/topic accuracy on a fixed multilingual set, plus a grounding check on real answers.
Run with the NLP service (port 8000), backend (5000) and Ollama running:
    venv\\Scripts\\python.exe eval\\chat_eval.py            # understanding only (fast)
    venv\\Scripts\\python.exe eval\\chat_eval.py --answers  # also checks generated answers for invented facts
"""
import json
import re
import sys
import time
import uuid

import httpx

NLP = "http://127.0.0.1:8000"
BACKEND = "http://127.0.0.1:5000"

# (message, expected intent, expected topic or None for "any")
CASES = [
    # English
    ("How do I pay property tax?", "SERVICE_QUESTION", "property_tax"),
    ("Where can I pay my water bill online?", "SERVICE_QUESTION", "water"),
    ("How do I get a birth certificate for my baby?", "SERVICE_QUESTION", "birth_death_certificate"),
    ("How can I apply for building permission?", "SERVICE_QUESTION", "building_permission"),
    ("What is the address of the zone G office?", "SERVICE_QUESTION", "ward_info"),
    ("What is the PCMC helpline number?", "SERVICE_QUESTION", "contact"),
    ("Can I register my marriage online?", "SERVICE_QUESTION", "other_services"),
    ("How do I track my complaint?", "SERVICE_QUESTION", "complaint_help"),
    ("There is a huge pothole near my house", "COMPLAINT", "roads"),
    ("Street light outside my building is not working for a week", "COMPLAINT", "street_lights"),
    ("Drainage water is overflowing on our road", "COMPLAINT", "drainage"),
    ("No water supply in our society since yesterday", "COMPLAINT", "water"),
    ("What is the status of my complaint?", "COMPLAINT_STATUS", None),
    ("Status of PCMC-100009 please", "COMPLAINT_STATUS", None),
    ("Hello", "GREETING", None),
    ("What is the capital of France?", "OTHER", None),
    # Hindi
    ("संपत्ति कर कैसे भरें?", "SERVICE_QUESTION", "property_tax"),
    ("पानी का बिल ऑनलाइन कैसे भरें?", "SERVICE_QUESTION", "water"),
    ("मृत्यु प्रमाण पत्र कहाँ से मिलेगा?", "SERVICE_QUESTION", "birth_death_certificate"),
    ("मेरी गली में तीन दिन से कचरा नहीं उठाया गया है", "COMPLAINT", "garbage"),
    ("सड़क पर बड़े गड्ढे हैं, दुर्घटना हो सकती है", "COMPLAINT", "roads"),
    ("मेरी शिकायत की स्थिति क्या है?", "COMPLAINT_STATUS", None),
    ("नमस्ते", "GREETING", None),
    ("आज क्रिकेट मैच कौन जीता?", "OTHER", None),
    # Marathi
    ("मालमत्ता कर कसा भरायचा?", "SERVICE_QUESTION", "property_tax"),
    ("पाणीपट्टी ऑनलाइन कशी भरायची?", "SERVICE_QUESTION", "water"),
    ("जन्म दाखला कुठे मिळेल?", "SERVICE_QUESTION", "birth_death_certificate"),
    ("बांधकाम परवानगीसाठी अर्ज कसा करायचा?", "SERVICE_QUESTION", "building_permission"),
    ("क्षेत्रीय कार्यालय ब कुठे आहे?", "SERVICE_QUESTION", "ward_info"),
    ("आमच्या भागात चार दिवसांपासून कचरा उचलला नाही", "COMPLAINT", "garbage"),
    ("रस्त्यावरील दिवे बंद आहेत", "COMPLAINT", "street_lights"),
    ("गटार तुंबले आहे आणि घाण पाणी रस्त्यावर येत आहे", "COMPLAINT", "drainage"),
    ("माझ्या तक्रारीची स्थिती काय आहे?", "COMPLAINT_STATUS", None),
    ("नमस्कार", "GREETING", None),
    # Hinglish / romanised
    ("Property tax online kaha se bharu?", "SERVICE_QUESTION", "property_tax"),
    ("Property tax kasa bharaycha?", "SERVICE_QUESTION", "property_tax"),
    ("Water bill kaise pay karu?", "SERVICE_QUESTION", "water"),
    ("Birth certificate kaise milega?", "SERVICE_QUESTION", "birth_death_certificate"),
    ("Mere area mein 3 din se garbage nahi uthaya", "COMPLAINT", "garbage"),
    ("Road pe bahut bade gaddhe hai", "COMPLAINT", "roads"),
    ("Humare yahan paani nahi aa raha 2 din se", "COMPLAINT", "water"),
    ("Meri complaint ka status kya hai?", "COMPLAINT_STATUS", None),
    ("Zone B office kaha hai?", "SERVICE_QUESTION", "ward_info"),
    ("Bollywood ki nayi movie kaisi hai?", "OTHER", None),
]

# Service questions whose generated answers are checked for facts not present in the retrieved sources.
ANSWER_CASES = [
    "How do I pay property tax?", "Water bill kaise pay karu?", "जन्म दाखला कुठे मिळेल?", "How can I apply for building permission?",
    "What is the address of the zone G office?", "What is the PCMC helpline number?", "How do I apply for a trade license?",
    "What is the fee for building permission?", "Can I get a Fire NOC online?", "मालमत्ता कर कसा भरायचा?",
]

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
NUMBER = re.compile(r"\d[\d\s-]{5,}\d")
WRONG_CORPORATION = re.compile(r"Pune Municipal|पुणे महानगरपालिका|पुणे नगर|पुणे महानगर", re.I)
DOMAIN = re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:in|com|gov|org)\b", re.I)


def evaluate_understanding():
    intent_ok = topic_ok = topic_total = 0
    failures = []
    started = time.time()
    for message, intent, topic in CASES:
        r = httpx.post(f"{NLP}/chat/understand", json={"message": message}, timeout=60).json()
        good_intent = r["intent"] == intent
        good_topic = topic is None or r["topic"] == topic
        intent_ok += good_intent
        if topic is not None:
            topic_total += 1
            topic_ok += good_topic
        if not (good_intent and good_topic):
            failures.append(f'  "{message}" -> {r["intent"]}/{r["topic"]} (expected {intent}/{topic or "any"})')
    n = len(CASES)
    print(f"Understanding: intent {intent_ok}/{n} ({intent_ok / n:.0%}), topic {topic_ok}/{topic_total} ({topic_ok / topic_total:.0%}), "
          f"avg {(time.time() - started) / n:.1f}s per message")
    if failures:
        print("Misclassified:\n" + "\n".join(failures))
    return intent_ok / n


def evaluate_answers():
    session = f"eval-{uuid.uuid4().hex[:12]}"
    invented = []
    handoffs = 0
    for i, message in enumerate(ANSWER_CASES):
        if i:
            time.sleep(5.5)  # stay under the public chat rate limit (12/min)
        meta, answer = None, ""
        with httpx.stream("POST", f"{BACKEND}/api/chat/message", json={"message": message, "sessionId": session, "uiLanguage": "en"}, timeout=120) as r:
            for line in r.iter_lines():
                if not line:
                    continue
                event = json.loads(line)
                if event["type"] == "meta":
                    meta = event
                elif event["type"] == "done":
                    answer = event["answer"]
        understood = httpx.post(f"{NLP}/chat/understand", json={"message": message}, timeout=60).json()
        source_text = " ".join(d["content"] + " " + d.get("serviceUrl", "") for d in understood["documents"]).lower()
        if not meta["sources"]:
            handoffs += 1
        answer_ascii = answer.translate(DEVANAGARI_DIGITS)
        numbers = {re.sub(r"\D", "", n) for n in NUMBER.findall(answer_ascii)}
        source_digits = re.sub(r"[\s-]", "", source_text.translate(DEVANAGARI_DIGITS)) + " 8888006666"
        bad = [n for n in numbers if n not in source_digits]
        bad += [d for d in DOMAIN.findall(answer_ascii) if d.lower() not in source_text]
        # PCMC must never be called the Pune corporation.
        bad += [m for m in WRONG_CORPORATION.findall(answer)]
        status = "OK" if not bad else f"INVENTED {bad}"
        print(f'  [{status}] {"handoff" if not meta["sources"] else "grounded"} | {message}\n      {answer[:220]}')
        if bad:
            invented.append(message)
    print(f"Answers: {len(ANSWER_CASES) - len(invented)}/{len(ANSWER_CASES)} with no invented phone numbers, websites or wrong corporation name; {handoffs} honest hand-offs")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    evaluate_understanding()
    if "--answers" in sys.argv:
        evaluate_answers()
