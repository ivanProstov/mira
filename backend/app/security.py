from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import HTTPException, Request

from .config import Settings

SESSION_COOKIE = "mira_session"
ROOM_COOKIE = "mira_access"
TOKEN_TTL = 14 * 24 * 3600


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64decode(raw: str) -> bytes:
    pad = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + pad)


def same_text(left: str, right: str) -> bool:
    digest_left = hashlib.sha256(left.encode()).digest()
    digest_right = hashlib.sha256(right.encode()).digest()
    return hmac.compare_digest(digest_left, digest_right)


def encode_token(payload: dict[str, Any], settings: Settings) -> str:
    body = _b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
    signature = hmac.new(settings.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def decode_token(token: str, settings: Settings) -> dict[str, Any] | None:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(settings.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        data = json.loads(_b64decode(body))
        if not isinstance(data, dict):
            return None
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return data
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def issue_session(settings: Settings, role: str, user_id: str, name: str) -> str:
    return encode_token(
        {
            "kind": "session",
            "role": role,
            "uid": user_id,
            "name": name,
            "exp": int(time.time()) + TOKEN_TTL,
        },
        settings,
    )


def issue_room_token(settings: Settings, session: dict[str, Any], room_id: str, name: str) -> str:
    return encode_token(
        {
            "kind": "room",
            "role": session["role"],
            "uid": session["uid"],
            "name": name,
            "room": room_id,
            "exp": int(time.time()) + TOKEN_TTL,
        },
        settings,
    )


def read_session(request: Request, settings: Settings) -> dict[str, Any] | None:
    header = request.headers.get("authorization", "")
    token = ""
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    if not token:
        token = request.cookies.get(SESSION_COOKIE, "")
    if not token:
        return None
    data = decode_token(token, settings)
    if not data or data.get("kind") != "session":
        return None
    return data


def require_session(request: Request, settings: Settings) -> dict[str, Any]:
    data = read_session(request, settings)
    if not data:
        raise HTTPException(status_code=401, detail="Нужно войти")
    return data


def require_tutor(request: Request, settings: Settings) -> dict[str, Any]:
    data = require_session(request, settings)
    if data.get("role") != "tutor":
        raise HTTPException(status_code=403, detail="Это может только репетитор")
    return data


def room_tokens(request: Request) -> list[str]:
    raw = request.cookies.get(ROOM_COOKIE, "")
    if not raw:
        return []
    return [part for part in raw.split("|") if part]


def find_room_access(request: Request, settings: Settings, room_id: str) -> dict[str, Any] | None:
    header = request.headers.get("authorization", "")
    candidates: list[str] = []
    if header.lower().startswith("bearer "):
        candidates.append(header[7:].strip())
    candidates.extend(room_tokens(request))
    query_token = request.query_params.get("access", "")
    if query_token:
        candidates.append(query_token)
    for token in candidates:
        data = decode_token(token, settings)
        if data and data.get("kind") == "room" and data.get("room") == room_id:
            return data
    return None


def require_room(request: Request, settings: Settings, room_id: str) -> dict[str, Any]:
    data = find_room_access(request, settings, room_id)
    if not data:
        raise HTTPException(status_code=403, detail="Нет доступа к этой комнате")
    return data


def upsert_room_cookie(existing: list[str], new_token: str, settings: Settings) -> str:
    new_data = decode_token(new_token, settings)
    if not new_data:
        return "|".join(existing)
    room_id = new_data["room"]
    kept: list[str] = []
    for token in existing:
        data = decode_token(token, settings)
        if not data or data.get("kind") != "room":
            continue
        if data.get("room") == room_id:
            continue
        if int(data.get("exp", 0)) < int(time.time()):
            continue
        kept.append(token)
    kept.append(new_token)
    return "|".join(kept[-10:])


def cookie_kwargs(settings: Settings) -> dict[str, Any]:
    return {
        "httponly": True,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "max_age": TOKEN_TTL,
        "path": "/",
    }


def clean_name(value: str, limit: int = 40) -> str:
    text = " ".join(str(value).split())
    text = "".join(ch for ch in text if ch.isprintable())
    if len(text) > limit:
        text = text[:limit].rstrip()
    return text
