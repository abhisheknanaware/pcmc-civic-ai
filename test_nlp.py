import requests
import json
import time

url = "http://localhost:8000/process"

# Wait a moment for server to boot
time.sleep(10)

test_complaints = [
    "There are massive potholes on FC Road that are causing traffic accidents.",
    "Kachra pichle 4 dino se collect nahi hua hai Swargate ke pass.",
    "My property tax bill is showing an incorrect amount."
]

print("Testing PMC Complaint Routing Pipeline...\n" + "="*50)
for text in test_complaints:
    print(f"\n[Input]: {text}")
    try:
        response = requests.post(url, data={"text": text})
        data = response.json()
        print(f"Category: {data.get('category')} (Conf: {data.get('categoryConfidence')})")
        print(f"Subcategory: {data.get('subcategory')} (Conf: {data.get('subcategoryConfidence')})")
        print(f"Priority: {data.get('priority')}")
        print(f"Department: {data.get('department')}")
    except Exception as e:
        print(f"Error: {e}")
