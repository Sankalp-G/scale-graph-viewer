from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

import grpc

import app.proto.nowcast_pb2 as nowcast_pb2
import app.proto.nowcast_pb2_grpc as nowcast_pb2_grpc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app")

DEFAULT_GRPC_SERVER = os.getenv("NOWCAST_GRPC_SERVER", "10.24.24.28:50053")
DEFAULT_CAMERA_NAMES = [
    "Garudamall_JN2_FIX-1",   "Garudamall_JN4_HD-1",   "Mayohall_JN1_FIX_1",   "Mayohall_JN2_FIX_1",   "Mayohall_JN3_FIX_1",   "Brigade_Rd_St_Pat_Church_JN1_FIX_1",   "Brigade_Rd_St_Pat_Church_JN2_FIX_1",   "Commisrate_Rd_ftball_Stdm_JN1_FIX_1",   "Commisrate_Rd_ftball_Stdm_JN3_FIX_1",   "Life_Styl_JN2_FIX_1",   "Life_Styl_JN4_FIX_3",   "Vellara_JN3_FIX_1",   "Johnson_Mrkt_JN2_FIX_1",   "Commis_Rd_ftball_Stdm_JN2_FIX_1",   "Life_Styl_JN1_HD_1",   "Life_Styl_JN1_PTZ_1",   "Life_Styl_JN3_FIX_2",   "Old_PS_Crle_Nr_Giriyas_JN1_FIX_1",   "Richmond_Rd_Mthr_Tersa_Rd_JN1_FIX_1",   "Richmond_Rd_Mthr_Tersa_Rd_JN2_FIX_2",   "Vellara_JN1_FIX_1",   "Vellara_JN2_PTZ_1",   "Richmond_Crlc_JN1_FIX_1",   "Richmond_Crlc_JN2_FIX_1",   "Richmond_Crlc_JN3_FIX_1",   "Richmond_Crlc_JN4_FIX_1",   "KH_Rd_Cmg_frm_Mission_Rd_JN1_FIX_1",   "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_1",   "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_2",   "KH_Rd_Nr_Madhutyres_JN2_FIX_1",   "KH_Rd_JN_Nr_Madhutyres_JN3_FIX_1",   "Cash_Phrmcy_JN2_FIX_1",   "Bishop_Ctn_Grls_Schl_RsdncyRd_JN2_FIX_1",   "Ashirvadam_Crlc_RsdncyRd_JN1_FIX_1",   "Ashirvadam_Crlc_RsdncyRd_JN2_FIX_1",   "Cubbon_Rd_BRV_FIX_1",   "Cubbon_Rd_BRV_PTZ_1",   "Kamrarj_Rd_Cubbon_Rd_FIX_1",   "Kamrarj_Rd_Cubbon_Rd_FIX_2",   "MuseumRd_Ganesha_Tmpl_FIX_1",   "MuseumRd_Ganesha_Tmpl_FIX_2",   "MuseumRd_Ganesha_Tmpl_FIX_3",   "High_Court_Entrance_FIX_1",   "High_Court_Entrance_FIX_2",   "In_Fnt_Halsurgate_PolcStn_PTZ_1",   "In_Fnt_Halsurgate_PolcStn_HD_1",   "Bbmp_Bus_Stop_FIX_1",   "Bbmp_Bus_Stop_FIX_2",   "NR_Sqr_FIX_1",   "13th_Crs_Kandaya_Bhavana_FIX_1",   "13th_Crs_Kandaya_Bhavana_FIX_2",   "KR_Circle_JN_FIX_1",   "KR_Circle_HD_1",   "WEB_FIX_1",   "Dasarappa_Hssptl_Entrance_FIX_1",   "Dasarappa_Hssptl_Entrance_FIX_2",   "Dasarappa_Hssptl_Entrance_FIX_3",   "OTC_Rd_Beauty_Centre_FIX_1",   "OTC_Rd_Beauty_Centre_FIX_2",   "NR_Square_FIX_1",   "NR_Square_FIX_2",   "NR_Square_FIX_3",   "Townhall_FIX_1",   "Townhall_FIX_2",   "Townhall_HD_1",   "Townhall_PTZ_1",   "Kalinga_Roa_Bus_Std_FIX_1",   "Kalinga_Roa_Bus_Std_FIX_2",   "Kalinga_Roa_Bus_Std_FIX_3",   "Richmond_Circle_JN_FIX_1",   "Richmond_Circle_PTZ_1",   "RRMR_Rd_FIX_1",   "RRMR_Rd_FIX_2",   "RRMR_Rd_PTZ_1",   "Hudson_Circle_FIX_1",   "Hudson_Circle_HD_1",   "Mission_Rd_Bus_Stp_HD_1",   "Mission_Rd_Bus_Stp_HD_2",   "KB_Rd_FIX_1",   "Maharani_Cllge_Nr_Bridge_FIX_1",   "Maharani_Cllge_Nr_Bridge_FIX_2",   "Oni_Anjaneya_Tmpl_FIX_1",   "Oni_Anjaneya_Tmpl_FIX_2",   "CTO_Circle_JN_PTZ_1"
]


class StartRequest(BaseModel):
    camera_names: Optional[List[str]] = None
    server: Optional[str] = None


stream_state = {
    "status": "idle",
    "camera_names": DEFAULT_CAMERA_NAMES,
    "server": DEFAULT_GRPC_SERVER,
    "request_id": 0,
}
state_lock = asyncio.Lock()
latest_lock = asyncio.Lock()
latest_message: Optional[Dict[str, object]] = None
stream_task: Optional[asyncio.Task] = None
task_lock = asyncio.Lock()
connections_lock = asyncio.Lock()
connections: List[WebSocket] = []


def ensure_grpc_ready() -> None:
    if grpc is None or nowcast_pb2 is None or nowcast_pb2_grpc is None:
        grpc_detail = repr(_grpc_error) if _grpc_error else "ok"
        proto_detail = repr(_proto_error) if _proto_error else "ok"
        raise HTTPException(
            status_code=503,
            detail=(
                "gRPC dependencies missing. Ensure grpcio/protobuf are installed and "
                "generate nowcast_pb2.py and nowcast_pb2_grpc.py under backend/. "
                f"grpc_import={grpc_detail} proto_import={proto_detail}"
            ),
        )


def normalize_epoch(timestamp: int) -> Optional[str]:
    if timestamp is None:
        return None
    value = int(timestamp)
    if value < 0:
        return None
    if value > 1_000_000_000_000_000:
        seconds = value / 1_000_000_000
    elif value > 1_000_000_000_000:
        seconds = value / 1_000
    else:
        seconds = value
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def extract_stream_timestamp(update) -> Optional[str]:
    for value in update.streams.values():
        if value.timestamp < 0:
            continue
        timestamp = normalize_epoch(value.timestamp)
        if timestamp:
            return timestamp
    return None


async def ensure_stream_task() -> None:
    global stream_task
    async with task_lock:
        if stream_task is None or stream_task.done():
            stream_task = asyncio.create_task(run_nowcast_stream())


async def run_nowcast_stream() -> None:
    while True:
        async with state_lock:
            status = stream_state["status"]
            request_id = stream_state["request_id"]
            camera_names = list(stream_state["camera_names"])
            server = stream_state["server"]

        if status != "inprogress":
            await asyncio.sleep(0.2)
            continue

        if grpc is None or nowcast_pb2 is None or nowcast_pb2_grpc is None:
            logger.error("gRPC dependencies missing for nowcasting stream.")
            await asyncio.sleep(1)
            continue

        try:
            await consume_stream(server, camera_names, request_id)
        except Exception:
            logger.exception("Nowcasting gRPC stream failed.")
            await asyncio.sleep(1)


async def consume_stream(server: str, camera_names: List[str], request_id: int) -> None:
    request = nowcast_pb2.NowcastRequest(camera_names=camera_names)
    async with grpc.aio.insecure_channel(server) as channel:
        stub = nowcast_pb2_grpc.NowcastServiceStub(channel)
        async for update in stub.Stream(request):
            async with state_lock:
                status = stream_state["status"]
                if status != "inprogress" or stream_state["request_id"] != request_id:
                    return

            message = {
                "timestamp": extract_stream_timestamp(update),
                "edge_results": [
                    {
                        "edge_id": result.edge_id,
                        "count": int(result.count),
                        "classification": int(result.classification),
                    }
                    for result in update.edge_results
                ],
            }
            global latest_message
            async with latest_lock:
                latest_message = message
            await broadcast(message)


async def broadcast(message: Dict[str, object]) -> None:
    async with connections_lock:
        targets = list(connections)
    if not targets:
        return
    results = await asyncio.gather(
        *[target.send_json(message) for target in targets],
        return_exceptions=True,
    )
    disconnected: List[WebSocket] = []
    for target, result in zip(targets, results):
        if isinstance(result, Exception):
            disconnected.append(target)
    if disconnected:
        async with connections_lock:
            for target in disconnected:
                if target in connections:
                    connections.remove(target)


@router.post("/start")
async def start_stream(payload: Optional[StartRequest] = None) -> Dict[str, str]:
    ensure_grpc_ready()
    async with state_lock:
        stream_state["status"] = "inprogress"
        if payload and payload.camera_names is not None:
            stream_state["camera_names"] = (
                payload.camera_names or list(DEFAULT_CAMERA_NAMES)
            )
        if payload and payload.server:
            stream_state["server"] = payload.server
        stream_state["request_id"] += 1
        logger.warning(
            "nowcasting start: server=%s cameras=%d",
            stream_state["server"],
            len(stream_state["camera_names"]),
        )
    await ensure_stream_task()
    return {"status": "inprogress"}


@router.get("/status")
async def get_status() -> Dict[str, str]:
    return {"status": stream_state["status"]}


@router.websocket("/ws/flow")
async def stream_flow(websocket: WebSocket) -> None:
    await websocket.accept()
    async with connections_lock:
        connections.append(websocket)
    async with latest_lock:
        message = latest_message
    if message:
        await websocket.send_json(message)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        async with connections_lock:
            if websocket in connections:
                connections.remove(websocket)
