from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services.flow_store import load_flow_store

router = APIRouter(prefix="/sample")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
flow_store = load_flow_store(DATA_DIR)
stream_state = {"status": "idle"}
state_lock = asyncio.Lock()


@router.post("/start")
async def start_stream() -> Dict[str, str]:
    async with state_lock:
        stream_state["status"] = "inprogress"
    return {"status": "inprogress"}


@router.get("/status")
async def get_status() -> Dict[str, str]:
    return {"status": stream_state["status"]}


@router.websocket("/ws/flow")
async def stream_flow(websocket: WebSocket) -> None:
    await websocket.accept()
    index = 0
    last_status = "idle"
    try:
        while True:
            async with state_lock:
                status = stream_state["status"]

            if status != "inprogress" or flow_store.total_frames == 0:
                last_status = status
                await asyncio.sleep(0.2)
                continue

            if last_status != "inprogress":
                index = 0
                last_status = "inprogress"

            frame_index = index % flow_store.total_frames
            edge_results = flow_store.build_edge_results(frame_index)
            message = {
                "timestamp": flow_store.timestamps[frame_index],
                "edge_results": edge_results,
            }
            await websocket.send_json(message)
            index = (index + 1) % flow_store.total_frames
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return
