from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import json
import random
from datetime import datetime
from loguru import logger

from astro_finance.api.engine import MarketIntelligenceEngine

app = FastAPI(title="Astro Finance Nerve Center", description="Market & Cosmos Intelligence Interface API")

# Minimalist CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "alive", "system": "Astro Finance", "time": datetime.utcnow().isoformat()}

@app.websocket("/ws/pulse")
async def websocket_pulse(websocket: WebSocket):
    """
    The Lifeblood Stream.
    Emits a 60Hz (or slower) state vector containing:
    - Indicator Score (0-100)
    - Market Flow (Particle System Data)
    - Cosmos State
    """
    await websocket.accept()
    logger.info("Visual Cortex Connected via WebSocket")
    print("DEBUG: WebSocket Accepted")
    
    try:
        print("DEBUG: Initializing Engine...")
        engine = MarketIntelligenceEngine()
        print("DEBUG: Loading Models...")
        engine.load_models() 
        print("DEBUG: Models Loaded.") 
        
        while True:
            pulse_state = engine.get_system_state()
            await websocket.send_json(pulse_state)
            await asyncio.sleep(1)
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Pulse Disconnected: {e}")
        # await websocket.close()

def start():
    """Entry point for poetry scripts"""
    uvicorn.run("astro_finance.api.main:app", host="0.0.0.0", port=8000, reload=False)

if __name__ == "__main__":
    start()
