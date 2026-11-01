import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, loadDisplayName, saveDisplayName } from "../api";
import { useAuth } from "../auth";
import { Board } from "../board/Board";
import type { Room } from "../types";

export function BoardPage() {
  const { roomId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(() => loadDisplayName(user?.name || ""));

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const display = loadDisplayName(user.name || "");
    const open =
      user.role === "tutor" ? api.enter(roomId, display || user.name || "Репетитор") : api.room(roomId);
    open
      .then((info) => {
        if (alive) setRoom(info);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        const message = reason instanceof Error ? reason.message : "Нет доступа к комнате";
        if (user.role === "student") navigate("/app", { replace: true, state: { message } });
        else setError(message);
      });
    return () => {
      alive = false;
    };
  }, [navigate, roomId, user]);

  if (!user) return null;
  if (error) {
    return (
      <main className="gate">
        <div className="card">
          <h1>Комната не открылась</h1>
          <p className="form-error">{error}</p>
          <button type="button" className="btn primary" onClick={() => navigate("/app")}>
            К комнатам
          </button>
        </div>
      </main>
    );
  }
  if (!room) return <div className="splash">Открываем доску…</div>;

  return (
    <Board
      key={room.id}
      room={room}
      role={user.role}
      displayName={name || room.yourName || user.name || "Ученик"}
      onRename={(value) => {
        setName(value);
        saveDisplayName(value);
      }}
      onRoom={setRoom}
    />
  );
}
