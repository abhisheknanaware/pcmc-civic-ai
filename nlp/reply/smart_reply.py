import requests
import json

def generate_reply(text: str, category: str, sentiment: str) -> str:
    """
    Calls a local Ollama instance (Llama3 or Mistral) to generate a smart reply.
    """
    prompt = f"""
    You are an empathetic customer support agent. 
    A customer has sent the following complaint: "{text}"
    The issue is categorized as "{category}" and the customer's sentiment is "{sentiment}".
    Write a brief, professional, and helpful response to this customer. Do not include placeholders like [Name].
    """
    
    # URL for local Ollama instance (default port 11434)
    url = "http://localhost:11434/api/generate"
    
    payload = {
        "model": "mistral", # Or "llama3" depending on what is installed
        "prompt": prompt,
        "stream": False
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            return response.json().get("response", "").strip()
    except Exception as e:
        print(f"Error calling Ollama: {e}")
        
    # Fallback reply
    return "Thank you for reaching out. We apologize for the inconvenience and will look into this immediately."
