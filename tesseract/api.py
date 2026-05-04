# api.py

from fastapi import FastAPI
from pydantic import BaseModel
from tesseract.core import process_user_input
from tesseract.config import SYSTEM_PROMPT, DEFAULT_PARAMS

app = FastAPI(title="Omni API - Tesseract")

class ChatRequest(BaseModel):
    message: str
    mode: str = "normal"

@app.post("/chat")
async def chat(request: ChatRequest):
    result = process_user_input(request.message, request.mode)
    
    # Here you would normally call the LLM with SYSTEM_PROMPT + user message
    # For now we return the geometry analysis
    
    return {
        "system": "Tesseract Sovereign Truth Engine",
        "result": result,
        "note": "Connect this to Claude, DeepSeek, or Llama for full responses"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
