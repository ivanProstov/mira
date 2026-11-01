import os
import tempfile

ROOT = tempfile.mkdtemp(prefix="mira-test-")
os.environ["DATA_DIR"] = ROOT
os.environ["SECRET_KEY"] = "test-secret-key-which-is-long-enough"
os.environ["TUTOR_USERNAME"] = "tutor"
os.environ["TUTOR_PASSWORD"] = "tutor-pass"
os.environ["STUDENT_USERNAME"] = "student"
os.environ["STUDENT_PASSWORD"] = "student-pass"
os.environ["TUTOR_NAME"] = "Репетитор"
os.environ["COOKIE_SECURE"] = "0"
os.environ["TRUST_PROXY"] = "0"

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_state


@pytest.fixture()
def tutor():
    with TestClient(app) as client:
        get_state().store.wipe()
        get_state().hub.rooms.clear()
        get_state().login_limit.reset()
        get_state().join_limit.reset()
        yield client


@pytest.fixture()
def student():
    with TestClient(app) as client:
        yield client


def login(client: TestClient, username: str, password: str) -> dict:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def test_pdf_becomes_page_images(tutor: TestClient):
    import io

    import pypdfium2 as pdfium

    login(tutor, "tutor", "tutor-pass")
    room = tutor.post("/api/rooms", json={"name": "Учебник", "password": "maple42"}).json()
    tutor.post(f"/api/rooms/{room['id']}/enter", json={"name": "Анна"})
    pdf = pdfium.PdfDocument.new()
    pdf.new_page(300, 400)
    pdf.new_page(300, 400)
    buffer = io.BytesIO()
    pdf.save(buffer)
    uploaded = tutor.post(
        f"/api/rooms/{room['id']}/files",
        files={"file": ("unit.pdf", buffer.getvalue(), "application/pdf")},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["kind"] == "pdf"
    assert len(body["pages"]) == 2
    assert body["pages"][0]["width"] == 1400
    assert tutor.get(f"/api/files/{body['pages'][0]['id']}").status_code == 200


def test_login_and_roles(tutor: TestClient, student: TestClient):
    bad = tutor.post("/api/auth/login", json={"username": "tutor", "password": "nope"})
    assert bad.status_code == 401

    tutor_body = login(tutor, "tutor", "tutor-pass")
    assert tutor_body["role"] == "tutor"
    assert tutor.get("/api/me").json()["role"] == "tutor"

    login(student, "student", "student-pass")
    forbidden = student.get("/api/rooms")
    assert forbidden.status_code == 403
    assert student.post("/api/rooms", json={"name": "A", "password": "secret1"}).status_code == 403


def test_room_passwords_are_tutor_only(tutor: TestClient, student: TestClient):
    login(tutor, "tutor", "tutor-pass")
    login(student, "student", "student-pass")

    created = tutor.post("/api/rooms", json={"name": "Артём", "password": "maple42"})
    assert created.status_code == 201
    room = created.json()
    assert room["password"] == "maple42"
    assert tutor.get("/api/rooms").json()["rooms"][0]["password"] == "maple42"

    missing = student.post("/api/rooms/join", json={"name": "Артём", "password": "wrong"})
    assert missing.status_code == 404

    joined = student.post("/api/rooms/join", json={"name": "Артём", "password": "maple42"})
    assert joined.status_code == 200
    body = joined.json()
    assert body["id"] == room["id"]
    assert "password" not in body

    listed = student.get(f"/api/rooms/{room['id']}")
    assert listed.status_code == 200
    assert "password" not in listed.json()

    other = tutor.post("/api/rooms", json={"name": "Маша", "password": "birch18"})
    assert other.status_code == 201
    assert student.get(f"/api/rooms/{other.json()['id']}").status_code == 403
    assert student.post(f"/api/rooms/{other.json()['id']}/enter", json={"name": "Артём"}).status_code == 403


def test_tutor_can_change_password_student_cannot(tutor: TestClient, student: TestClient):
    login(tutor, "tutor", "tutor-pass")
    login(student, "student", "student-pass")
    room = tutor.post("/api/rooms", json={"name": "Группа", "password": "maple42"}).json()

    denied = student.patch(f"/api/rooms/{room['id']}", json={"password": "hacked"})
    assert denied.status_code == 403

    changed = tutor.patch(f"/api/rooms/{room['id']}", json={"password": "cedar77", "name": "Группа Б"})
    assert changed.status_code == 200
    assert changed.json()["password"] == "cedar77"
    assert changed.json()["name"] == "Группа Б"

    duplicate = tutor.post("/api/rooms", json={"name": "Ещё", "password": "cedar77"})
    assert duplicate.status_code == 409

    assert student.post("/api/rooms/join", json={"name": "Артём", "password": "maple42"}).status_code == 404
    assert student.post("/api/rooms/join", json={"name": "Артём", "password": "cedar77"}).status_code == 200


def wait_for(socket, predicate, limit: int = 12):
    last = None
    for _ in range(limit):
        last = socket.receive_json()
        if predicate(last):
            return last
    raise AssertionError(last)


def test_board_sync_cursors_and_files(tutor: TestClient, student: TestClient):
    import io

    from PIL import Image

    login(tutor, "tutor", "tutor-pass")
    login(student, "student", "student-pass")
    room = tutor.post("/api/rooms", json={"name": "Урок 1", "password": "maple42"}).json()
    assert tutor.post(f"/api/rooms/{room['id']}/enter", json={"name": "Анна"}).status_code == 200
    assert student.post("/api/rooms/join", json={"name": "Артём", "password": "maple42"}).status_code == 200

    buffer = io.BytesIO()
    Image.new("RGB", (8, 6), (20, 80, 60)).save(buffer, format="PNG")
    uploaded = tutor.post(
        f"/api/rooms/{room['id']}/files",
        files={"file": ("note.png", buffer.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    file_id = uploaded.json()["file"]["id"]
    assert tutor.get(f"/api/files/{file_id}").status_code == 200
    assert student.get(f"/api/files/{file_id}").status_code == 200

    with TestClient(app) as stranger:
        login(stranger, "student", "student-pass")
        assert stranger.get(f"/api/files/{file_id}").status_code == 403

    with tutor.websocket_connect(f"/ws/{room['id']}") as tutor_ws:
        hello_tutor = tutor_ws.receive_json()
        assert hello_tutor["type"] == "hello"
        assert hello_tutor["you"]["role"] == "tutor"
        with student.websocket_connect(f"/ws/{room['id']}") as student_ws:
            hello_student = student_ws.receive_json()
            assert hello_student["you"]["name"] == "Артём"
            peers = wait_for(
                tutor_ws,
                lambda packet: packet["type"] == "peers"
                and any(person["name"] == "Артём" for person in packet["peers"]),
            )
            assert any(person["role"] == "tutor" for person in peers["peers"])

            item = {
                "id": "note123456",
                "type": "sticky",
                "x": 10,
                "y": 20,
                "w": 180,
                "h": 120,
                "z": 1,
                "text": "friendly — дружелюбный",
                "fill": "#fff3a8",
            }
            tutor_ws.send_json({"type": "op", "opId": "op-1", "op": {"type": "upsert", "item": item}})
            echoed = wait_for(tutor_ws, lambda packet: packet.get("opId") == "op-1")
            remote = wait_for(student_ws, lambda packet: packet.get("opId") == "op-1")
            assert echoed["op"]["item"]["text"].startswith("friendly")
            assert remote["op"]["item"]["id"] == "note123456"

            student_ws.send_json({"type": "cursor", "x": 120, "y": 80})
            student_ws.send_json({"type": "viewport", "x": 40, "y": 15, "zoom": 1.25})
            cursor = wait_for(tutor_ws, lambda packet: packet["type"] == "cursor" and packet.get("name") == "Артём")
            viewport = wait_for(tutor_ws, lambda packet: packet["type"] == "viewport" and packet.get("zoom") == 1.25)
            assert cursor["x"] == 120
            assert viewport["y"] == 15

    version, items = get_state().store.board(room["id"])
    assert version == 1
    assert items[0]["text"] == "friendly — дружелюбный"
    assert tutor.delete(f"/api/rooms/{room['id']}").status_code == 204
    assert tutor.get(f"/api/files/{file_id}").status_code == 404
