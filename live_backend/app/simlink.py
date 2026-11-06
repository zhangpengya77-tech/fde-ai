"""手機遙控器配對（WebRTC 信令）服務 2026-11-07

用途：模擬器（筆電）與手機遙控器要建立「點對點」連線（WebRTC DataChannel），
連線前雙方必須交換一次連線描述（SDP，含可連線的位址）。這個模組只負責「轉交」：

  1. 筆電：POST /api/simlink/rooms            送出 offer → 取得 6 碼配對碼
  2. 手機：GET  /api/simlink/rooms/{code}/offer  用配對碼（掃 QR 碼）取得 offer
  3. 手機：POST /api/simlink/rooms/{code}/answer 送回 answer
  4. 筆電：GET  /api/simlink/rooms/{code}/answer 每 1.5 秒問一次，拿到後就直接連線

連線建立後，搖桿數值在手機與筆電之間直接傳送，不再經過伺服器（延遲低，也不耗用
Cloudflare 免費額度）。

安全邊界：
- 不需要登入（手機掃碼即可用）；只保存兩段連線描述，不含帳號、Cookie 或個資
- 配對碼 3 分鐘失效、answer 只能送一次、內容上限 16KB、同時最多 200 組
- 全部存在記憶體，服務重啟即清空；不寫入資料庫或檔案
"""
from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, field

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from .errors import error_response, json_response

# 避免容易看錯的字元（0/O、1/I/L）
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
ROOM_TTL_SECONDS = 180
MAX_ROOMS = 200
MAX_BODY_BYTES = 16 * 1024


@dataclass
class Room:
    offer: str
    created: float
    answer: str | None = None
    answered_at: float | None = None
    meta: dict = field(default_factory=dict)


class SimLinkStore:
    """記憶體中的配對房間；clock 可注入以便測試過期"""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.rooms: dict[str, Room] = {}

    def _purge(self) -> None:
        now = self.clock()
        for code in [c for c, r in self.rooms.items() if now - r.created > ROOM_TTL_SECONDS]:
            del self.rooms[code]

    def create(self, offer: str) -> str | None:
        self._purge()
        if len(self.rooms) >= MAX_ROOMS:
            return None
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                break
        self.rooms[code] = Room(offer=offer, created=self.clock())
        return code

    def get(self, code: str) -> Room | None:
        self._purge()
        return self.rooms.get(code.upper())

    def answer(self, code: str, answer: str) -> str:
        room = self.get(code)
        if room is None:
            return "not_found"
        if room.answer is not None:
            return "already_answered"
        room.answer = answer
        room.answered_at = self.clock()
        return "ok"


async def _read_sdp(request: Request, key: str) -> str | None:
    """讀取並檢查 JSON 內容：必須是 {key: {type, sdp}}，且大小在上限內"""
    body = await request.body()
    if not body or len(body) > MAX_BODY_BYTES:
        return None
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    desc = payload.get(key) if isinstance(payload, dict) else None
    if not isinstance(desc, dict) or desc.get("type") not in ("offer", "answer") or not isinstance(desc.get("sdp"), str):
        return None
    return json.dumps({"type": desc["type"], "sdp": desc["sdp"]})


def simlink_routes(store: SimLinkStore | None = None) -> list[Route]:
    store = store or SimLinkStore()

    async def create_room(request: Request) -> Response:
        offer = await _read_sdp(request, "offer")
        if offer is None:
            return error_response("simlink_bad_offer", "連線描述格式不正確或太大。", 400)
        code = store.create(offer)
        if code is None:
            return error_response("simlink_busy", "目前配對太多，請稍後再試。", 503)
        return json_response({"code": code, "ttlSeconds": ROOM_TTL_SECONDS}, status_code=201)

    async def get_offer(request: Request) -> Response:
        room = store.get(request.path_params["code"])
        if room is None:
            return error_response("simlink_not_found", "配對碼不存在或已過期，請在模擬器重新產生。", 404)
        if room.answer is not None:
            return error_response("simlink_taken", "這個配對碼已經被其他手機使用。", 409)
        return json_response({"offer": json.loads(room.offer)})

    async def post_answer(request: Request) -> Response:
        answer = await _read_sdp(request, "answer")
        if answer is None:
            return error_response("simlink_bad_answer", "連線描述格式不正確或太大。", 400)
        result = store.answer(request.path_params["code"], answer)
        if result == "not_found":
            return error_response("simlink_not_found", "配對碼不存在或已過期，請在模擬器重新產生。", 404)
        if result == "already_answered":
            return error_response("simlink_taken", "這個配對碼已經被其他手機使用。", 409)
        return json_response({"ok": True})

    async def get_answer(request: Request) -> Response:
        room = store.get(request.path_params["code"])
        if room is None:
            return error_response("simlink_not_found", "配對碼已過期。", 404)
        if room.answer is None:
            # 還沒有手機回應：204（沒有內容），模擬器稍後再問
            return Response(status_code=204, headers={"Cache-Control": "no-store"})
        return json_response({"answer": json.loads(room.answer)})

    return [
        Route("/api/simlink/rooms", create_room, methods=["POST"]),
        Route("/api/simlink/rooms/{code:str}/offer", get_offer, methods=["GET"]),
        Route("/api/simlink/rooms/{code:str}/answer", post_answer, methods=["POST"]),
        Route("/api/simlink/rooms/{code:str}/answer", get_answer, methods=["GET"]),
    ]
