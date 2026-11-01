from __future__ import annotations

import asyncio
import logging
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from .config import Settings, get_settings
from .hub import Hub, Peer, color_for
from .pdfimg import image_size, render_pdf, sniff
from .security import (
    ROOM_COOKIE,
    SESSION_COOKIE,
    clean_name,
    cookie_kwargs,
    find_room_access,
    issue_room_token,
    issue_session,
    require_room,
    require_session,
    require_tutor,
    room_tokens,
    same_text,
    upsert_room_cookie,
)
from .store import Store, _inside

log = logging.getLogger("mira")
MAX_UPLOAD = 40 * 1024 * 1024

MIME = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


class Limiter:
    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self.hits: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.time()
        recent = [stamp for stamp in self.hits.get(key, []) if now - stamp < self.window]
        if len(recent) >= self.limit:
            self.hits[key] = recent
            return False
        recent.append(now)
        self.hits[key] = recent
        return True

    def reset(self) -> None:
        self.hits.clear()


class AppState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = Store(settings.data_dir / "mira.sqlite3")
        self.hub = Hub()
        self.login_limit = Limiter(30, 60)
        self.join_limit = Limiter(60, 60)


state: AppState | None = None


def get_state() -> AppState:
    if state is None:
        raise RuntimeError("Приложение ещё не запущено")
    return state


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host
    return "unknown"


def authenticate(settings: Settings, username: str, password: str) -> tuple[str, str] | None:
    if same_text(username, settings.tutor_username):
        if same_text(password, settings.tutor_password):
            return "tutor", settings.tutor_name
        return None
    if same_text(username, settings.student_username) and same_text(password, settings.student_password):
        return "student", ""
    return None


async def read_upload(file: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="Файл больше 40 МБ")
        chunks.append(chunk)
    if not chunks:
        raise HTTPException(status_code=400, detail="Файл пустой")
    return b"".join(chunks)


def public_room(room: dict, include_password: bool) -> dict:
    data = {
        "id": room["id"],
        "name": room["name"],
        "createdAt": room["createdAt"],
        "updatedAt": room["updatedAt"],
    }
    if include_password:
        data["password"] = room["password"]
    return data


def create_app() -> FastAPI:
    app = FastAPI(title="Mira", docs_url=None, redoc_url=None, openapi_url=None)

    @app.on_event("startup")
    def startup() -> None:
        global state
        if state is not None:
            return
        settings = get_settings()
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        state = AppState(settings)
        log.info("Mira storage: %s", settings.data_dir)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/api/auth/login")
    async def login(request: Request) -> JSONResponse:
        current = get_state()
        ip = client_ip(request, current.settings)
        if not current.login_limit.allow(ip):
            raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите минуту")
        body = await request.json()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        found = authenticate(current.settings, username, password)
        if not found:
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        role, name = found
        user_id = secrets.token_hex(8)
        token = issue_session(current.settings, role, user_id, name)
        response = JSONResponse({"role": role, "name": name, "userId": user_id})
        response.set_cookie(SESSION_COOKIE, token, **cookie_kwargs(current.settings))
        response.delete_cookie(ROOM_COOKIE, path="/")
        return response

    @app.post("/api/auth/logout")
    def logout() -> Response:
        response = Response(status_code=204)
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.delete_cookie(ROOM_COOKIE, path="/")
        return response

    @app.get("/api/me")
    def me(request: Request) -> dict:
        current = get_state()
        session = require_session(request, current.settings)
        return {"role": session["role"], "name": session.get("name") or "", "userId": session["uid"]}

    @app.get("/api/rooms")
    def list_rooms(request: Request) -> dict:
        current = get_state()
        require_tutor(request, current.settings)
        rooms = [public_room(room, True) for room in current.store.list_rooms()]
        return {"rooms": rooms}

    @app.post("/api/rooms")
    async def create_room(request: Request) -> JSONResponse:
        current = get_state()
        require_tutor(request, current.settings)
        body = await request.json()
        try:
            room = current.store.create_room(str(body.get("name") or ""), str(body.get("password") or ""))
        except ValueError as error:
            raise HTTPException(status_code=409 if "пароль" in str(error) else 400, detail=str(error)) from error
        log.info("room created %s", room["id"])
        return JSONResponse(public_room(room, True), status_code=201)

    @app.get("/api/rooms/{room_id}")
    def get_room(room_id: str, request: Request) -> dict:
        current = get_state()
        session = require_session(request, current.settings)
        access = find_room_access(request, current.settings, room_id)
        if session.get("role") != "tutor" and not access:
            raise HTTPException(status_code=403, detail="Нет доступа к этой комнате")
        try:
            room = current.store.get_room(room_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Комната не найдена") from None
        return public_room(room, session.get("role") == "tutor")

    @app.patch("/api/rooms/{room_id}")
    async def update_room(room_id: str, request: Request) -> dict:
        current = get_state()
        require_tutor(request, current.settings)
        body = await request.json()
        name = body.get("name")
        password = body.get("password")
        try:
            room = current.store.update_room(
                room_id,
                None if name is None else str(name),
                None if password is None else str(password),
            )
        except KeyError:
            raise HTTPException(status_code=404, detail="Комната не найдена") from None
        except ValueError as error:
            status = 409 if "другой комнате" in str(error) else 400
            raise HTTPException(status_code=status, detail=str(error)) from error
        return public_room(room, True)

    @app.delete("/api/rooms/{room_id}")
    def delete_room(room_id: str, request: Request) -> Response:
        current = get_state()
        require_tutor(request, current.settings)
        try:
            current.store.delete_room(room_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Комната не найдена") from None
        return Response(status_code=204)

    @app.post("/api/rooms/{room_id}/enter")
    async def enter_room(room_id: str, request: Request) -> JSONResponse:
        current = get_state()
        session = require_tutor(request, current.settings)
        try:
            room = current.store.get_room(room_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Комната не найдена") from None
        body: dict = {}
        if request.headers.get("content-type", "").startswith("application/json"):
            body = await request.json()
        name = clean_name(str(body.get("name") or "")) or session.get("name") or current.settings.tutor_name
        token = issue_room_token(current.settings, session, room_id, name)
        response = JSONResponse({**public_room(room, True), "yourName": name})
        packed = upsert_room_cookie(room_tokens(request), token, current.settings)
        response.set_cookie(ROOM_COOKIE, packed, **cookie_kwargs(current.settings))
        return response

    @app.post("/api/rooms/join")
    async def join_room(request: Request) -> JSONResponse:
        current = get_state()
        session = require_session(request, current.settings)
        ip = client_ip(request, current.settings)
        if not current.join_limit.allow(ip):
            raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите минуту")
        body = await request.json()
        password = str(body.get("password") or "").strip()
        name = clean_name(str(body.get("name") or ""))
        if session.get("role") == "student" and not name:
            raise HTTPException(status_code=400, detail="Напишите, как вас зовут")
        if not name:
            name = session.get("name") or current.settings.tutor_name
        room = current.store.find_by_password(password)
        if not room:
            raise HTTPException(status_code=404, detail="Комната с таким паролем не найдена")
        token = issue_room_token(current.settings, session, room["id"], name)
        response = JSONResponse({**public_room(room, session.get("role") == "tutor"), "yourName": name})
        packed = upsert_room_cookie(room_tokens(request), token, current.settings)
        response.set_cookie(ROOM_COOKIE, packed, **cookie_kwargs(current.settings))
        return response

    @app.post("/api/rooms/{room_id}/files")
    async def upload_file(room_id: str, request: Request, file: UploadFile = File(...)) -> dict:
        current = get_state()
        require_room(request, current.settings, room_id)
        try:
            current.store.get_room(room_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Комната не найдена") from None
        data = await read_upload(file)
        kind = sniff(data)
        if kind is None:
            raise HTTPException(status_code=400, detail="Нужен PDF или картинка PNG, JPEG, GIF, WebP")
        dest_dir = current.store.upload_root
        if kind == "pdf":
            try:
                pages = await asyncio.to_thread(render_pdf, data, dest_dir)
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            except Exception as error:
                log.exception("pdf render failed")
                raise HTTPException(status_code=400, detail="Не удалось открыть PDF") from error
            current.store.add_files(room_id, pages)
            return {
                "kind": "pdf",
                "pages": [{"id": page["id"], "width": page["width"], "height": page["height"]} for page in pages],
            }
        try:
            width, height = image_size(data)
        except Exception as error:
            raise HTTPException(status_code=400, detail="Не удалось прочитать картинку") from error
        file_id = secrets.token_hex(16)
        extension = "jpg" if kind == "jpeg" else kind
        path = dest_dir / f"{file_id}.{extension}"
        path.write_bytes(data)
        saved = current.store.add_file(room_id, file_id, file.filename or f"image.{extension}", MIME[kind], path, width, height)
        return {"kind": "image", "file": saved}

    @app.get("/api/files/{file_id}")
    def read_file(file_id: str, request: Request) -> FileResponse:
        current = get_state()
        require_session(request, current.settings)
        row = current.store.get_file(file_id)
        if not row:
            raise HTTPException(status_code=404, detail="Файл не найден")
        if not find_room_access(request, current.settings, row["room_id"]):
            raise HTTPException(status_code=403, detail="Нет доступа к этому файлу")
        path = Path(row["path"])
        if not path.is_file() or not _inside(path, current.store.upload_root):
            raise HTTPException(status_code=404, detail="Файл не найден")
        return FileResponse(
            path,
            media_type=row["mime"],
            filename=row["name"],
            content_disposition_type="inline",
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400"},
        )

    @app.websocket("/ws/{room_id}")
    async def room_socket(websocket: WebSocket, room_id: str) -> None:
        await websocket.accept()
        current = get_state()
        access = find_room_access(websocket, current.settings, room_id)  # type: ignore[arg-type]
        if not access:
            await websocket.send_json({"type": "error", "message": "Нет доступа к этой комнате"})
            await websocket.close(code=4401)
            return
        try:
            version, items = current.store.board(room_id)
        except KeyError:
            await websocket.send_json({"type": "error", "message": "Комната не найдена"})
            await websocket.close(code=4404)
            return

        conn_id = secrets.token_hex(4)
        peer = Peer(
            conn_id=conn_id,
            user_id=str(access["uid"]),
            name=str(access.get("name") or "Гость"),
            role=str(access.get("role") or "student"),
            color=color_for(str(access.get("role") or "student"), str(access["uid"])),
            socket=websocket,
        )
        current.hub.add(room_id, peer)
        try:
            await websocket.send_json(
                {
                    "type": "hello",
                    "you": {
                        "connId": peer.conn_id,
                        "name": peer.name,
                        "role": peer.role,
                        "color": peer.color,
                    },
                    "version": version,
                    "items": items,
                    "peers": [person for person in current.hub.snapshot(room_id) if person["connId"] != conn_id],
                }
            )
            await current.hub.broadcast(
                room_id,
                {"type": "peers", "peers": current.hub.snapshot(room_id)},
            )
            while True:
                message = await websocket.receive_json()
                try:
                    await handle_message(current, room_id, peer, message)
                except WebSocketDisconnect:
                    raise
                except Exception:
                    log.exception("message failed")
        except WebSocketDisconnect:
            pass
        except Exception:
            log.exception("socket closed")
        finally:
            current.hub.remove(room_id, conn_id)
            await current.hub.broadcast(room_id, {"type": "peers", "peers": current.hub.snapshot(room_id)})

    return app


async def handle_message(current: AppState, room_id: str, peer: Peer, message: object) -> None:
    if not isinstance(message, dict):
        return
    kind = message.get("type")
    if kind == "cursor":
        x = message.get("x")
        y = message.get("y")
        if x is None or y is None:
            peer.cursor = None
            await current.hub.broadcast(
                room_id,
                {"type": "cursor", "connId": peer.conn_id, "x": None, "y": None},
                skip=peer.conn_id,
            )
            return
        try:
            px = float(x)
            py = float(y)
        except (TypeError, ValueError):
            return
        if abs(px) > 1_000_000 or abs(py) > 1_000_000:
            return
        peer.cursor = {"x": px, "y": py}
        await current.hub.broadcast(
            room_id,
            {
                "type": "cursor",
                "connId": peer.conn_id,
                "x": round(px, 1),
                "y": round(py, 1),
                "name": peer.name,
                "color": peer.color,
                "role": peer.role,
            },
            skip=peer.conn_id,
        )
        return
    if kind == "viewport":
        try:
            viewport = {
                "x": round(float(message.get("x")), 2),
                "y": round(float(message.get("y")), 2),
                "zoom": round(float(message.get("zoom")), 4),
            }
        except (TypeError, ValueError):
            return
        if not 0.05 <= viewport["zoom"] <= 4:
            return
        if abs(viewport["x"]) > 5_000_000 or abs(viewport["y"]) > 5_000_000:
            return
        peer.viewport = viewport
        await current.hub.broadcast(
            room_id,
            {"type": "viewport", "connId": peer.conn_id, **viewport},
            skip=peer.conn_id,
        )
        return
    if kind == "name":
        name = clean_name(str(message.get("name") or ""))
        if not name:
            return
        peer.name = name
        await current.hub.broadcast(room_id, {"type": "peers", "peers": current.hub.snapshot(room_id)})
        return
    if kind == "op":
        op = message.get("op")
        op_id = str(message.get("opId") or "")
        if not isinstance(op, dict) or len(op_id) > 80:
            return
        try:
            result = await asyncio.to_thread(current.store.apply, room_id, op)
        except KeyError:
            await peer.socket.send_json({"type": "error", "message": "Комната не найдена"})
            return
        except ValueError as error:
            version, items = current.store.board(room_id)
            await peer.socket.send_json(
                {"type": "resync", "message": str(error), "version": version, "items": items}
            )
            return
        await current.hub.broadcast(
            room_id,
            {
                "type": "op",
                "opId": op_id,
                "op": result["op"],
                "version": result["version"],
                "connId": peer.conn_id,
            },
        )
        return


app = create_app()
