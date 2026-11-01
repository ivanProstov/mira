from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from fastapi import WebSocket

PALETTE = ["#d64545", "#e07a2f", "#c8960c", "#1f7ad6", "#7a45c4", "#d63d86", "#0f766e", "#3d6b1f"]


def color_for(role: str, user_id: str) -> str:
    if role == "tutor":
        return "#0f6b4c"
    number = int(hashlib.sha256(user_id.encode()).hexdigest()[:8], 16)
    return PALETTE[number % len(PALETTE)]


@dataclass
class Peer:
    conn_id: str
    user_id: str
    name: str
    role: str
    color: str
    socket: WebSocket
    viewport: dict | None = None
    cursor: dict | None = None


@dataclass
class Hub:
    rooms: dict[str, dict[str, Peer]] = field(default_factory=dict)

    def add(self, room_id: str, peer: Peer) -> None:
        self.rooms.setdefault(room_id, {})[peer.conn_id] = peer

    def remove(self, room_id: str, conn_id: str) -> Peer | None:
        room = self.rooms.get(room_id)
        if not room:
            return None
        peer = room.pop(conn_id, None)
        if not room:
            self.rooms.pop(room_id, None)
        return peer

    def get(self, room_id: str, conn_id: str) -> Peer | None:
        return self.rooms.get(room_id, {}).get(conn_id)

    def snapshot(self, room_id: str) -> list[dict]:
        room = self.rooms.get(room_id, {})
        people = []
        for peer in room.values():
            people.append(
                {
                    "connId": peer.conn_id,
                    "name": peer.name,
                    "role": peer.role,
                    "color": peer.color,
                    "viewport": peer.viewport,
                }
            )
        people.sort(key=lambda item: (item["role"] != "tutor", item["name"].lower()))
        return people

    async def broadcast(self, room_id: str, message: dict, skip: str | None = None) -> None:
        room = list(self.rooms.get(room_id, {}).values())
        dead: list[str] = []
        for peer in room:
            if peer.conn_id == skip:
                continue
            try:
                await peer.socket.send_json(message)
            except Exception:
                dead.append(peer.conn_id)
        for conn_id in dead:
            self.remove(room_id, conn_id)
