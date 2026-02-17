#!/usr/bin/env python3

import grpc
import argparse
import logging

import app.proto.nowcast_pb2 as nowcast_pb2
import app.proto.nowcast_pb2_grpc as nowcast_pb2_grpc

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_stream_names_from_camera_list(path):
    names = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 2:
                continue
            names.append(parts[1])
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="10.24.24.28:50052")
    parser.add_argument("--stream-ids", type=str, nargs="+", help="Camera names (2nd column)")
    parser.add_argument("--camera-list", type=str, help="Path to camera_list.txt")
    parser.add_argument("--count", type=int, default=0, help="Number of updates to print (0 = forever)")
    parser.add_argument("--return-every", type=float, default=1.0, help="Seconds between updates (sent to server)")
    parser.add_argument("--history-size", type=int, default=1, help="Number of last rows per stream (sent to server)")
    args = parser.parse_args()

    if args.stream_ids is not None:
        camera_names = args.stream_ids
    elif args.camera_list:
        camera_names = load_stream_names_from_camera_list(args.camera_list)
    else:
        camera_names = [
            "13th_Crs_Kandaya_Bhavana_FIX_1", "Brigade_Rd_St_Pat_Church_JN1_FIX_1", "Cubbon_Rd_BRV_PTZ_1", "Hudson_Circle_HD_1", "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_2", "Mayohall_JN1_FIX_1", "Old_Hgh_Grnd_Ps_FIX_1", "Richmond_Crlc_JN3_FIX_1", "Townhall_PTZ_1", "13th_Crs_Kandaya_Bhavana_FIX_2", "Brigade_Rd_St_Pat_Church_JN2_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_1", "In_Fnt_Halsurgate_PolcStn_HD_1", "KH_Rd_JN_Nr_Madhutyres_JN3_FIX_1", "Mayohall_JN2_FIX_1", "Old_Hgh_Grnd_Ps_FIX_2", "Richmond_Crlc_JN4_FIX_1", "Vellara_JN1_FIX_1", "Ashirvadam_Crlc_RsdncyRd_JN1_FIX_1", "Cash_Phrmcy_JN2_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_2", "In_Fnt_Halsurgate_PolcStn_PTZ_1", "KH_Rd_Nr_Madhutyres_JN2_FIX_1", "Mayohall_JN3_FIX_1", "Old_Hgh_Grnd_Ps_FIX_3", "Richmond_Rd_Mthr_Tersa_Rd_JN1_FIX_1", "Vellara_JN2_PTZ_1", "Ashirvadam_Crlc_RsdncyRd_JN2_FIX_1", "Chandhrika_Hotel_FIX_1", "Dasarappa_Hssptl_Entrance_FIX_3", "Johnson_Mrkt_JN2_FIX_1", "KR_Circle_HD_1", "Mission_Rd_Bus_Stp_HD_1", "Old_PS_Crle_Nr_Giriyas_JN1_FIX_1", "Richmond_Rd_Mthr_Tersa_Rd_JN2_FIX_2", "Vellara_JN3_FIX_1", "Balabruie_Guest_House_FIX_1", "Chandhrika_Hotel_FIX_2", "KR_Circle_JN_FIX_1", "Kalinga_Roa_Bus_Std_FIX_1", "Mission_Rd_Bus_Stp_HD_2", "Oni_Anjaneya_Tmpl_FIX_1", "RRMR_Rd_FIX_1", "WEB_FIX_1", "Bbmp_Bus_Stop_FIX_2", "CTO_Circle_JN_PTZ_1", "Hosuru_Rd_Cmtry_Rd_JN3_PTZ_1", "KH_Rd_Cmg_frm_Mission_Rd_JN1_FIX_1", "Maharani_Cllge_Nr_Bridge_FIX_1", "NR_Square_FIX_2", "Richmond_Crlc_JN1_FIX_1", "Townhall_FIX_2", "Bishop_Ctn_Grls_Schl_RsdncyRd_JN2_FIX_1", "Cubbon_Rd_BRV_FIX_1", "Hudson_Circle_FIX_1", "Townhall_HD_1", "KH_Rd_Cmg_frm_Mission_Rd_JN2_FIX_1", "Maharani_Cllge_Nr_Bridge_FIX_2", "NR_Square_FIX_3", "Richmond_Crlc_JN2_FIX_1", "Balabruie_Guest_House_FIX_2", "Chandhrika_Hotel_FIX_3", "Garudamall_JN2_FIX-1", "Kalinga_Roa_Bus_Std_FIX_2", "Life_Styl_JN1_HD_1", "MuseumRd_Ganesha_Tmpl_FIX_1", "Oni_Anjaneya_Tmpl_FIX_2", "RRMR_Rd_FIX_2", "Balekundri_Circle_FIX_1", "Chandhrika_Hotel_PTZ_1", "Garudamall_JN4_HD-1", "Kalinga_Roa_Bus_Std_FIX_3", "Life_Styl_JN1_PTZ_1", "MuseumRd_Ganesha_Tmpl_FIX_2", "OTC_Rd_Beauty_Centre_FIX_1", "RRMR_Rd_PTZ_1", "Balekundri_Circle_FIX_2", "Commisrate_Rd_ftball_Stdm_JN1_FIX_1", "High_Court_Entrance_FIX_1", "Kamrarj_Rd_Cubbon_Rd_FIX_1", "Life_Styl_JN2_FIX_1", "MuseumRd_Ganesha_Tmpl_FIX_3", "OTC_Rd_Beauty_Centre_FIX_2", "Seven_Minister_FIX_1", "Balekundri_Circle_HD_1", "Commisrate_Rd_ftball_Stdm_JN3_FIX_1", "High_Court_Entrance_FIX_2", "Kamrarj_Rd_Cubbon_Rd_FIX_2", "Life_Styl_JN3_FIX_2", "NR_Sqr_FIX_1", "Richmond_Circle_JN_FIX_1", "Seven_Minister_FIX_2", "Bbmp_Bus_Stop_FIX_1", "Commis_Rd_ftball_Stdm_JN2_FIX_1", "Hosuru_Rd_Cmtry_JN1_FIX_1", "KB_Rd_FIX_1", "Life_Styl_JN4_FIX_3", "NR_Square_FIX_1", "Richmond_Circle_PTZ_1", "Townhall_FIX_1"
        ]

    with grpc.insecure_channel(args.server) as channel:
        stub = nowcast_pb2_grpc.NowcastServiceStub(channel)
        req = nowcast_pb2.NowcastRequest(camera_names=camera_names)
        if hasattr(req, "return_every_seconds"):
            req.return_every_seconds = args.return_every
        if hasattr(req, "history_size"):
            req.history_size = args.history_size
        n = 0
        for update in stub.Stream(req):
            logger.info("================================================")
            logger.info("timestamp_datetime: %s", update.timestamp_datetime)
            for i, er_list in enumerate(update.edge_results_per_timestep):
                triples = [(er.edge_id, er.count, er.classification) for er in er_list.results]
                logger.info("  step %d: %s", i, triples)
            logger.info("================================================")
            n += 1
            if args.count > 0 and n >= args.count:
                break


if __name__ == "__main__":
    main()
 
