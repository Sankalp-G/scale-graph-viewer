from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Mapping, Optional, Tuple

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

try:
    import grpc

    _grpc_error: Optional[BaseException] = None
except Exception as exc:  # pragma: no cover - import guard
    grpc = None
    _grpc_error = exc

try:
    import app.proto.forecast_streaming_pb2 as forecast_streaming_pb2
    import app.proto.forecast_streaming_pb2_grpc as forecast_streaming_pb2_grpc

    _proto_error: Optional[BaseException] = None
except Exception as exc:  # pragma: no cover - import guard
    forecast_streaming_pb2 = None
    forecast_streaming_pb2_grpc = None
    _proto_error = exc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/forecast-stream")

DEFAULT_GRPC_SERVER = os.getenv("FORECAST_STREAM_GRPC_SERVER", "10.24.24.28:50055")
DEFAULT_RETURN_EVERY_SECONDS = float(os.getenv("FORECAST_STREAM_RETURN_EVERY_SECONDS", "5.0"))
DEFAULT_LAG_SECONDS = int(os.getenv("FORECAST_STREAM_LAG_SECONDS", "300"))
DEFAULT_STREAM_IDS = [
    "13th_Crs_Kandaya_Bhavana_FIX_1", "Brigade_Rd_St_Pat_Church_JN1_FIX_1", "Cubbon_Rd_BRV_PTZ_1", "Hudson_Circle_HD_1", "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_2", "Mayohall_JN1_FIX_1", "Old_Hgh_Grnd_Ps_FIX_1", "Richmond_Crlc_JN3_FIX_1", "Townhall_PTZ_1", "13th_Crs_Kandaya_Bhavana_FIX_2", "Brigade_Rd_St_Pat_Church_JN2_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_1", "In_Fnt_Halsurgate_PolcStn_HD_1", "KH_Rd_JN_Nr_Madhutyres_JN3_FIX_1", "Mayohall_JN2_FIX_1", "Old_Hgh_Grnd_Ps_FIX_2", "Richmond_Crlc_JN4_FIX_1", "Vellara_JN1_FIX_1", "Ashirvadam_Crlc_RsdncyRd_JN1_FIX_1", "Cash_Phrmcy_JN2_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_2", "In_Fnt_Halsurgate_PolcStn_PTZ_1", "KH_Rd_Nr_Madhutyres_JN2_FIX_1", "Mayohall_JN3_FIX_1", "Old_Hgh_Grnd_Ps_FIX_3", "Richmond_Rd_Mthr_Tersa_Rd_JN1_FIX_1", "Vellara_JN2_PTZ_1", "Ashirvadam_Crlc_RsdncyRd_JN2_FIX_1", "Chandhrika_Hotel_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_3", "Johnson_Mrkt_JN2_FIX_1", "KR_Circle_HD_1", "Mission_Rd_Bus_Stp_HD_1", "Old_PS_Crle_Nr_Giriyas_JN1_FIX_1", "Richmond_Rd_Mthr_Tersa_Rd_JN2_FIX_2", "Vellara_JN3_FIX_1", "Balabruie_Guest_House_FIX_1", "Chandhrika_Hotel_FIX_2", "KR_Circle_JN_FIX_1", "Kalinga_Roa_Bus_Std_FIX_1", "Mission_Rd_Bus_Stp_HD_2", "Oni_Anjaneya_Tmpl_FIX_1", "RRMR_Rd_FIX_1", "WEB_FIX_1", "Bbmp_Bus_Stop_FIX_2", "CTO_Circle_JN_PTZ_1", "Hosuru_Rd_Cmtry_Rd_JN3_PTZ_1", "KH_Rd_Cmg_frm_Mission_Rd_JN1_FIX_1", "Maharani_Cllge_Nr_Bridge_FIX_1", "NR_Square_FIX_2", "Richmond_Crlc_JN1_FIX_1", "Townhall_FIX_2", "Bishop_Ctn_Grls_Schl_RsdncyRd_JN2_FIX_1", "Cubbon_Rd_BRV_FIX_1", "Hudson_Circle_FIX_1", "Townhall_HD_1", "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_1", "Maharani_Cllge_Nr_Bridge_FIX_2", "NR_Square_FIX_3", "Richmond_Crlc_JN2_FIX_1", "Balabruie_Guest_House_FIX_2", "Chandhrika_Hotel_FIX_3", "Garudamall_JN2_FIX-1", "Kalinga_Roa_Bus_Std_FIX_2", "Life_Styl_JN1_HD_1", "MuseumRd_Ganesha_Tmpl_FIX_1", "Oni_Anjaneya_Tmpl_FIX_2", "RRMR_Rd_FIX_2", "Balekundri_Circle_FIX_1", "Chandhrika_Hotel_PTZ_1", "Garudamall_JN4_HD-1", "Kalinga_Roa_Bus_Std_FIX_3", "Life_Styl_JN1_PTZ_1", "MuseumRd_Ganesha_Tmpl_FIX_2", "OTC_Rd_Beauty_Centre_FIX_1", "RRMR_Rd_PTZ_1", "Balekundri_Circle_FIX_2", "Commisrate_Rd_ftball_Stdm_JN1_FIX_1", "High_Court_Entrance_FIX_1", "Kamrarj_Rd_Cubbon_Rd_FIX_1", "Life_Styl_JN2_FIX_1", "MuseumRd_Ganesha_Tmpl_FIX_3", "OTC_Rd_Beauty_Centre_FIX_2", "Seven_Minister_FIX_1", "Balekundri_Circle_HD_1", "Commisrate_Rd_ftball_Stdm_JN3_FIX_1", "High_Court_Entrance_FIX_2", "Kamrarj_Rd_Cubbon_Rd_FIX_2", "Life_Styl_JN3_FIX_2", "NR_Sqr_FIX_1", "Richmond_Circle_JN_FIX_1", "Seven_Minister_FIX_2", "Bbmp_Bus_Stop_FIX_1", "Commis_Rd_ftball_Stdm_JN2_FIX_1", "Hosuru_Rd_Cmtry_JN1_FIX_1", "KB_Rd_FIX_1", "Life_Styl_JN4_FIX_3", "NR_Square_FIX_1", "Richmond_Circle_PTZ_1", "Townhall_FIX_1"
]


class StartRequest(BaseModel):
    stream_ids: Optional[List[str]] = None
    camera_names: Optional[List[str]] = None
    server: Optional[str] = None
    return_every_seconds: Optional[float] = None
    lag_seconds: Optional[int] = None
    horizon: Optional[str] = None


stream_state = {
    "status": "idle",
    "stream_ids": DEFAULT_STREAM_IDS,
    "server": DEFAULT_GRPC_SERVER,
    "return_every_seconds": DEFAULT_RETURN_EVERY_SECONDS,
    "lag_seconds": DEFAULT_LAG_SECONDS,
    "horizon": None,
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
    if grpc is None or forecast_streaming_pb2 is None or forecast_streaming_pb2_grpc is None:
        grpc_detail = repr(_grpc_error) if _grpc_error else "ok"
        proto_detail = repr(_proto_error) if _proto_error else "ok"
        raise HTTPException(
            status_code=503,
            detail=(
                "gRPC dependencies missing. Ensure grpcio/protobuf are installed and "
                "generate forecast_streaming_pb2.py and forecast_streaming_pb2_grpc.py under backend/. "
                f"grpc_import={grpc_detail} proto_import={proto_detail}"
            ),
        )


def choose_horizon(
    edge_results: Mapping[str, "forecast_streaming_pb2.EdgeResultList"],
    preferred: Optional[str],
) -> Tuple[Optional[str], Optional["forecast_streaming_pb2.EdgeResultList"]]:
    if not edge_results:
        return None, None
    if preferred and preferred in edge_results:
        return preferred, edge_results[preferred]
    if "0" in edge_results:
        return "0", edge_results["0"]
    numeric_keys = sorted(
        (int(key), key) for key in edge_results.keys() if key.isdigit()
    )
    if numeric_keys:
        _, key = numeric_keys[0]
        return key, edge_results[key]
    key = sorted(edge_results.keys())[0]
    return key, edge_results[key]


def shift_timestamp(timestamp: str, minutes: int = 5) -> str:
    if not timestamp:
        return timestamp
    cleaned = timestamp.strip()
    if not cleaned:
        return timestamp
    try:
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return timestamp
    shifted = parsed + timedelta(minutes=minutes)
    if timestamp.endswith("Z") and shifted.tzinfo is not None:
        return shifted.isoformat().replace("+00:00", "Z")
    return shifted.isoformat()


async def ensure_stream_task() -> None:
    global stream_task
    async with task_lock:
        if stream_task is None or stream_task.done():
            stream_task = asyncio.create_task(run_forecast_stream())


async def run_forecast_stream() -> None:
    while True:
        async with state_lock:
            status = stream_state["status"]
            request_id = stream_state["request_id"]
            stream_ids = list(stream_state["stream_ids"])
            server = stream_state["server"]
            return_every_seconds = stream_state["return_every_seconds"]
            lag_seconds = stream_state["lag_seconds"]
            horizon = stream_state["horizon"]

        if status != "inprogress":
            await asyncio.sleep(0.2)
            continue

        if grpc is None or forecast_streaming_pb2 is None or forecast_streaming_pb2_grpc is None:
            logger.error("gRPC dependencies missing for forecast streaming.")
            await asyncio.sleep(1)
            continue

        try:
            await consume_stream(
                server,
                stream_ids,
                lag_seconds,
                return_every_seconds,
                horizon,
                request_id,
            )
        except Exception:
            logger.exception("Forecast streaming gRPC stream failed.")
            await asyncio.sleep(1)


async def consume_stream(
    server: str,
    stream_ids: List[str],
    lag_seconds: int,
    return_every_seconds: float,
    horizon: Optional[str],
    request_id: int,
) -> None:
    return_every = max(1, int(return_every_seconds))
    request = forecast_streaming_pb2.ForecastStreamRequest(
        stream_ids=stream_ids,
        lag=lag_seconds,
        return_every=return_every,
    )
    async with grpc.aio.insecure_channel(server) as channel:
        stub = forecast_streaming_pb2_grpc.ForecastStreamServiceStub(channel)
        async for update in stub.StreamForecast(request):
            async with state_lock:
                status = stream_state["status"]
                if status != "inprogress" or stream_state["request_id"] != request_id:
                    return

            selected_key, selected_results = choose_horizon(
                update.edge_results,
                horizon,
            )
            results_payload = []
            if selected_results is not None:
                results_payload = [
                    {
                        "edge_id": result.edge_id,
                        "count": int(result.count),
                        "classification": int(result.classification),
                    }
                    for result in selected_results.results
                ]

            message = {
                "timestamp": shift_timestamp(update.timestamp, 5) if update.timestamp else None,
                "edge_results": results_payload,
                "horizon": selected_key,
                "success": bool(update.success),
                "message": update.message,
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
        if payload:
            if payload.stream_ids is not None:
                stream_state["stream_ids"] = payload.stream_ids or list(DEFAULT_STREAM_IDS)
            elif payload.camera_names is not None:
                stream_state["stream_ids"] = (
                    payload.camera_names or list(DEFAULT_STREAM_IDS)
                )
            if payload.server:
                stream_state["server"] = payload.server
            if payload.return_every_seconds is not None:
                stream_state["return_every_seconds"] = payload.return_every_seconds
            if payload.lag_seconds is not None:
                stream_state["lag_seconds"] = payload.lag_seconds
            if payload.horizon is not None:
                stream_state["horizon"] = payload.horizon
        stream_state["request_id"] += 1
        logger.warning(
            "forecast streaming start: server=%s streams=%d",
            stream_state["server"],
            len(stream_state["stream_ids"]),
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
