"""
WebSocket Integration for Real-Time Updates

Adds Socket.IO support to FastAPI for streaming live market data,
crash predictions, regime changes, and aspect alerts.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
import asyncio
import random
from datetime import datetime
from loguru import logger

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=['http://localhost:3000', 'http://localhost:3001'],
    logger=True,
    engineio_logger=True
)

# Wrap with ASGI app
socket_app = socketio.ASGIApp(
    sio,
    socketio_path='socket.io'
)

async def broadcast_market_update():
    """
    Broadcast real-time market updates every 5 seconds.
    Simulates live data streaming - replace with actual live data source.
    """
    while True:
        try:
            # Simulate market data (replace with actual API/websocket feed)
            update = {
                'timestamp': datetime.now().isoformat(),
                'price': 42544 + random.uniform(-100, 100),
                'crash_probability': random.uniform(0.10, 0.25),
                'market_regime': random.choice([0, 1, 2]),
                'regime_confidence': random.uniform(0.90, 0.98),
            }
            
            await sio.emit('market_update', update)
            logger.debug(f"Broadcast market update: ${update['price']:.2f}")
            
        except Exception as e:
            logger.error(f"Error broadcasting update: {e}")
        
        await asyncio.sleep(5)  # Update every 5 seconds


async def broadcast_aspect_alert(aspect_data):
    """
    Broadcast planetary aspect alerts when significant events occur.
    """
    alert = {
        'timestamp': datetime.now().isoformat(),
        'type': 'aspect_alert',
        'planets': aspect_data.get('planets', []),
        'aspect_type': aspect_data.get('aspect_type', 'conjunction'),
        'orb': aspect_data.get('orb', 0),
        'impact': aspect_data.get('impact', 'moderate'),
    }
    
    await sio.emit('aspect_alert', alert)
    logger.info(f"Aspect alert: {alert}")


async def broadcast_regime_change(old_regime, new_regime, confidence):
    """
    Alert when market regime changes.
    """
    regime_names = {0: 'Consolidation', 1: 'Bull Market', 2: 'Bear Market'}
    
    alert = {
        'timestamp': datetime.now().isoformat(),
        'type': 'regime_change',
        'old_regime': regime_names.get(old_regime, 'Unknown'),
        'new_regime': regime_names.get(new_regime, 'Unknown'),
        'confidence': confidence,
    }
    
    await sio.emit('regime_change', alert)
    logger.warning(f"Regime change: {alert['old_regime']} → {alert['new_regime']}")


@sio.event
async def connect(sid, environ):
    """Handle client connection."""
    logger.info(f"Client connected: {sid}")
    
    # Send initial state
    await sio.emit('connected', {
        'message': 'Connected to Astro Finance WebSocket',
        'timestamp': datetime.now().isoformat()
    }, room=sid)


@sio.event
async def disconnect(sid):
    """Handle client disconnection."""
    logger.info(f"Client disconnected: {sid}")


@sio.event
async def request_lunar_update(sid):
    """Client requests lunar phase update."""
    # Fetch current lunar data
    from astro_finance.astronomy import LunarPhaseCalculator
    
    lunar = LunarPhaseCalculator()
    sentiment = lunar.calculate_lunar_sentiment(datetime.now())
    
    await sio.emit('lunar_update', sentiment, room=sid)


@sio.event
async def request_gann_update(sid, data):
    """Client requests Gann analysis update."""
    # Process Gann request and send response
    logger.info(f"Gann update requested by {sid}: {data}")
    
    # Mock response (replace with actual Gann calculation)
    gann_data = {
        'timestamp': datetime.now().isoformat(),
        'price_vs_1x1': -8.94,
        'nearest_support': 40250,
        'nearest_resistance': 45600,
        'trend_strength': 'bearish',
    }
    
    await sio.emit('gann_update', gann_data, room=sid)


# Background task to broadcast updates
background_task = None

async def start_background_tasks():
    """Start background broadcasting tasks."""
    global background_task
    if background_task is None:
        background_task = asyncio.create_task(broadcast_market_update())
        logger.info("Background broadcast task started")


def setup_websocket(app: FastAPI):
    """
    Mount WebSocket to existing FastAPI app.
    
    Usage in api_server.py:
        from websocket_server import setup_websocket, start_background_tasks, sio
        
        setup_websocket(app)
        
        @app.on_event("startup")
        async def startup():
            await start_background_tasks()
    """
    app.mount('/ws', socket_app)
    logger.success("WebSocket server mounted at /ws")
    
    return sio


# Export for use in main app
__all__ = ['setup_websocket', 'start_background_tasks', 'sio', 'broadcast_aspect_alert', 'broadcast_regime_change']
