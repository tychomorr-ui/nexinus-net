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
    
    # Call your Omni API
    llm_response = await call_omni_api(
        message=request.message,
        system_prompt=SYSTEM_PROMPT,
        mode=request.mode,
        params=DEFAULT_PARAMS
    )
    
    return {
        "system": "Tesseract Sovereign Truth Engine",
        "geometry": result,  # Keep your geometry analysis
        "response": llm_response,  # Add LLM response
        "mode": request.mode
    }
    

   
    return {
        "system": "Tesseract Sovereign Truth Engine",
        "result": result,
        "note": "Connect this to Claude, DeepSeek, or Llama for full responses"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
