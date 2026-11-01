from __future__ import annotations

import json
import re
import secrets
import sqlite3
import time
from pathlib import Path
from threading import RLock

ITEM_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
TYPES = {"sticky", "text", "rect", "ellipse", "arrow", "pen", "highlight", "image", "frame"}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _num(value: object, limit: float = 1_000_000) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Некорректные координаты")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")) or abs(number) > limit:
        raise ValueError("Некорректные координаты")
    return round(number, 2)


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.upload_root = path.parent / "uploads" if path.name.endswith(".sqlite3") else path / "uploads"
        self.upload_root.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def _migrate(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_password ON rooms(password);
            CREATE TABLE IF NOT EXISTS boards (
                room_id TEXT PRIMARY KEY,
                items TEXT NOT NULL,
                version INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                path TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        self.conn.commit()

    def wipe(self) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM files")
            self.conn.execute("DELETE FROM boards")
            self.conn.execute("DELETE FROM rooms")
            self.conn.commit()
        for child in self.upload_root.glob("*"):
            if child.is_file():
                child.unlink()

    def create_room(self, name: str, password: str) -> dict:
        name = _room_name(name)
        password = _room_password(password)
        with self.lock:
            if self._password_owner(password):
                raise ValueError("Такой пароль уже стоит на другой комнате")
            room_id = secrets.token_hex(6)
            now = _now()
            self.conn.execute(
                "INSERT INTO rooms (id, name, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (room_id, name, password, now, now),
            )
            self.conn.execute(
                "INSERT INTO boards (room_id, items, version) VALUES (?, '[]', 0)",
                (room_id,),
            )
            self._commit_password()
        return self.get_room(room_id)

    def list_rooms(self) -> list[dict]:
        with self.lock:
            rows = self.conn.execute("SELECT * FROM rooms ORDER BY created_at DESC").fetchall()
        return [self._room_dict(row) for row in rows]

    def get_room(self, room_id: str) -> dict:
        with self.lock:
            row = self.conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
        if not row:
            raise KeyError(room_id)
        return self._room_dict(row)

    def find_by_password(self, password: str) -> dict | None:
        with self.lock:
            row = self.conn.execute("SELECT * FROM rooms WHERE password = ?", (password,)).fetchone()
        if not row:
            return None
        return self._room_dict(row)

    def update_room(self, room_id: str, name: str | None, password: str | None) -> dict:
        with self.lock:
            current = self.conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
            if not current:
                raise KeyError(room_id)
            next_name = _room_name(name) if name is not None else current["name"]
            next_password = _room_password(password) if password is not None else current["password"]
            owner = self._password_owner(next_password)
            if owner and owner != room_id:
                raise ValueError("Такой пароль уже стоит на другой комнате")
            self.conn.execute(
                "UPDATE rooms SET name = ?, password = ?, updated_at = ? WHERE id = ?",
                (next_name, next_password, _now(), room_id),
            )
            self._commit_password()
        return self.get_room(room_id)

    def delete_room(self, room_id: str) -> None:
        with self.lock:
            files = self.conn.execute("SELECT path FROM files WHERE room_id = ?", (room_id,)).fetchall()
            self.conn.execute("DELETE FROM files WHERE room_id = ?", (room_id,))
            self.conn.execute("DELETE FROM boards WHERE room_id = ?", (room_id,))
            deleted = self.conn.execute("DELETE FROM rooms WHERE id = ?", (room_id,)).rowcount
            self.conn.commit()
        if not deleted:
            raise KeyError(room_id)
        for row in files:
            path = Path(row["path"])
            if path.is_file() and _inside(path, self.upload_root):
                path.unlink()

    def add_file(self, room_id: str, file_id: str, name: str, mime: str, path: Path, width: int, height: int) -> dict:
        with self.lock:
            self.conn.execute(
                """
                INSERT INTO files (id, room_id, name, mime, path, width, height, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (file_id, room_id, name[:160], mime, str(path), width, height, _now()),
            )
            self.conn.commit()
        return {"id": file_id, "width": width, "height": height, "name": name}

    def add_files(self, room_id: str, pages: list[dict]) -> None:
        with self.lock:
            for page in pages:
                self.conn.execute(
                    """
                    INSERT INTO files (id, room_id, name, mime, path, width, height, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        page["id"],
                        room_id,
                        page["name"][:160],
                        page["mime"],
                        page["path"],
                        page["width"],
                        page["height"],
                        _now(),
                    ),
                )
            self.conn.commit()

    def get_file(self, file_id: str) -> dict | None:
        with self.lock:
            row = self.conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            return None
        return dict(row)

    def board(self, room_id: str) -> tuple[int, list]:
        with self.lock:
            return self._load(room_id)

    def apply(self, room_id: str, op: dict) -> dict:
        with self.lock:
            try:
                version, items = self._load(room_id)
                kind = op.get("type")
                if kind == "upsert":
                    item = self._sanitize(room_id, op.get("item"))
                    items = [existing for existing in items if existing["id"] != item["id"]]
                    items.append(item)
                    outgoing = {"type": "upsert", "item": item}
                elif kind == "upsert_many":
                    raw_items = op.get("items")
                    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 40:
                        raise ValueError("Слишком много объектов за один раз")
                    clean = [self._sanitize(room_id, raw) for raw in raw_items]
                    ids = {item["id"] for item in clean}
                    if len(ids) != len(clean):
                        raise ValueError("Повторяется id объекта")
                    items = [existing for existing in items if existing["id"] not in ids]
                    items.extend(clean)
                    outgoing = {"type": "upsert_many", "items": clean}
                elif kind == "delete":
                    item_id = _item_id(op.get("id"))
                    items = [existing for existing in items if existing["id"] != item_id]
                    outgoing = {"type": "delete", "id": item_id}
                else:
                    raise ValueError("Неизвестная операция")
                if len(items) > 3000:
                    raise ValueError("На доске слишком много объектов")
                version += 1
                self.conn.execute(
                    "UPDATE boards SET items = ?, version = ? WHERE room_id = ?",
                    (json.dumps(items, ensure_ascii=False, separators=(",", ":")), version, room_id),
                )
                self.conn.commit()
                return {"version": version, "op": outgoing}
            except Exception:
                self.conn.rollback()
                raise

    def _load(self, room_id: str) -> tuple[int, list]:
        row = self.conn.execute("SELECT items, version FROM boards WHERE room_id = ?", (room_id,)).fetchone()
        if not row:
            raise KeyError(room_id)
        return int(row["version"]), json.loads(row["items"])

    def _commit_password(self) -> None:
        try:
            self.conn.commit()
        except sqlite3.IntegrityError as error:
            self.conn.rollback()
            raise ValueError("Такой пароль уже стоит на другой комнате") from error

    def _password_owner(self, password: str) -> str | None:
        row = self.conn.execute("SELECT id FROM rooms WHERE password = ?", (password,)).fetchone()
        return None if row is None else str(row["id"])

    def _file_ids(self, room_id: str) -> set[str]:
        rows = self.conn.execute("SELECT id FROM files WHERE room_id = ?", (room_id,)).fetchall()
        return {row["id"] for row in rows}

    def _sanitize(self, room_id: str, raw: object) -> dict:
        if not isinstance(raw, dict):
            raise ValueError("Некорректный объект")
        kind = raw.get("type")
        if kind not in TYPES:
            raise ValueError("Неизвестный тип объекта")
        item: dict = {
            "id": _item_id(raw.get("id")),
            "type": kind,
            "x": _num(raw.get("x")),
            "y": _num(raw.get("y")),
            "w": _num(raw.get("w")),
            "h": _num(raw.get("h")),
            "z": int(_num(raw.get("z", 1), limit=1_000_000)),
        }
        if kind == "image":
            src = str(raw.get("src") or "")
            if src not in self._file_ids(room_id):
                raise ValueError("Картинка не из этой комнаты")
            item["src"] = src
        if kind in {"pen", "highlight"}:
            points = raw.get("points")
            if not isinstance(points, list) or len(points) < 2 or len(points) > 8000 or len(points) % 2:
                raise ValueError("Некорректная линия")
            item["points"] = [_num(point, limit=1_000_000) for point in points]
            width = _num(raw.get("strokeWidth", 22 if kind == "highlight" else 3), limit=80)
            item["strokeWidth"] = max(1, width)
            if kind == "highlight":
                raw_opacity = 0.5 if raw.get("opacity") is None else raw.get("opacity")
                item["opacity"] = min(1, max(0.05, _num(raw_opacity, limit=1)))
        elif "strokeWidth" in raw and raw.get("strokeWidth") is not None:
            item["strokeWidth"] = max(1, _num(raw.get("strokeWidth"), limit=40))
        for key in ("fill", "stroke"):
            if raw.get(key):
                color = str(raw[key])
                if not COLOR.match(color):
                    raise ValueError("Некорректный цвет")
                item[key] = color.lower()
        if "text" in raw and raw.get("text") is not None:
            text = str(raw.get("text"))
            if len(text) > 4000:
                raise ValueError("Слишком длинный текст")
            item["text"] = text
        if "alt" in raw and raw.get("alt"):
            item["alt"] = str(raw["alt"])[:160]
        if "fontSize" in raw and raw.get("fontSize") is not None:
            size = _num(raw.get("fontSize"), limit=120)
            item["fontSize"] = min(96, max(10, size))
        return item

    @staticmethod
    def _room_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "name": row["name"],
            "password": row["password"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


def _room_name(value: str | None) -> str:
    from .security import clean_name

    name = clean_name(value or "", 60)
    if not name:
        raise ValueError("У комнаты должно быть название")
    return name


def _room_password(value: str | None) -> str:
    password = str(value or "").strip()
    if len(password) < 4 or len(password) > 40:
        raise ValueError("Пароль комнаты: от 4 до 40 символов")
    if any(ord(ch) < 32 for ch in password):
        raise ValueError("В пароле комнаты нельзя использовать управляющие символы")
    return password


def _item_id(value: object) -> str:
    text = str(value or "")
    if not ITEM_ID.match(text):
        raise ValueError("Некорректный id объекта")
    return text


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False
