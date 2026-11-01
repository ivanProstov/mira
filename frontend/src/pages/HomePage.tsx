import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, saveDisplayName } from "../api";
import { useAuth } from "../auth";
import type { Room } from "../types";
import { Dialog, Wordmark } from "../ui";

export function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirected = (location.state as { message?: string } | null)?.message || "";
  if (!user) return null;
  return user.role === "tutor" ? (
    <TutorHome onLogout={() => void logout().then(() => navigate("/", { replace: true }))} />
  ) : (
    <StudentHome notice={redirected} onLogout={() => void logout().then(() => navigate("/", { replace: true }))} />
  );
}

function TutorHome({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [removing, setRemoving] = useState<Room | null>(null);

  async function reload() {
    const data = await api.rooms();
    setRooms(data.rooms);
  }

  useEffect(() => {
    reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить комнаты"));
  }, []);

  return (
    <main className="home">
      <header className="topbar">
        <Wordmark />
        <div className="topbar-side">
          <span className="role">Репетитор</span>
          <button type="button" className="btn ghost" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>
      <section className="home-body">
        <div className="section-head">
          <div>
            <h1>Комнаты</h1>
            <p>У каждой комнаты свой пароль. Ученик знает только свой и попадает только туда.</p>
          </div>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            Новая комната
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {rooms.length === 0 && !error && <p className="empty-copy">Комнат ещё нет. Создайте первую и продиктуйте ученику пароль.</p>}
        <div className="room-grid">
          {rooms.map((room) => (
            <article key={room.id} className="room-card">
              <h2>{room.name}</h2>
              <p className="when">{formatWhen(room.createdAt)}</p>
              <div className="secret">
                <span>Пароль</span>
                <strong>{room.password}</strong>
                <button type="button" onClick={() => void navigator.clipboard.writeText(room.password || "")}>
                  Копировать
                </button>
              </div>
              <div className="card-actions">
                <button type="button" className="btn primary" onClick={() => navigate(`/room/${room.id}`)}>
                  Открыть
                </button>
                <button type="button" className="btn ghost" onClick={() => setEditing(room)}>
                  Изменить
                </button>
                <button type="button" className="btn danger" onClick={() => setRemoving(room)}>
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {creating && (
        <RoomForm
          title="Новая комната"
          name=""
          password={suggestPassword()}
          submitLabel="Создать"
          onClose={() => setCreating(false)}
          onSubmit={async (name, password) => {
            const room = await api.createRoom(name, password);
            setRooms((current) => [room, ...current]);
          }}
        />
      )}
      {editing && (
        <RoomForm
          title="Изменить комнату"
          name={editing.name}
          password={editing.password || ""}
          submitLabel="Сохранить"
          onClose={() => setEditing(null)}
          onSubmit={async (name, password) => {
            const room = await api.updateRoom(editing.id, { name, password });
            setRooms((current) => current.map((item) => (item.id === room.id ? room : item)));
          }}
        />
      )}
      {removing && (
        <Dialog title="Удалить комнату?" onClose={() => setRemoving(null)}>
          <p className="hint">«{removing.name}» и всё, что на доске, исчезнет.</p>
          <div className="card-actions">
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const id = removing.id;
                void api.deleteRoom(id).then(() => {
                  setRooms((current) => current.filter((item) => item.id !== id));
                  setRemoving(null);
                });
              }}
            >
              Удалить
            </button>
            <button type="button" className="btn ghost" onClick={() => setRemoving(null)}>
              Оставить
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function StudentHome({ notice, onLogout }: { notice: string; onLogout: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(notice);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const trimmed = name.trim();
      saveDisplayName(trimmed);
      const room = await api.join(trimmed, password.trim());
      navigate(`/room/${room.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти в комнату");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="gate">
      <form className="card" onSubmit={(event) => void submit(event)}>
        <div className="card-top">
          <Wordmark />
          <button type="button" className="btn ghost" onClick={onLogout}>
            Выйти
          </button>
        </div>
        <h1>Войти в комнату</h1>
        <p className="lede">Имя увидят остальные рядом с вашим курсором. Пароль комнаты даёт репетитор.</p>
        <label>
          Как вас зовут
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus required />
        </label>
        <label>
          Пароль комнаты
          <input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Открываем…" : "На доску"}
        </button>
      </form>
    </main>
  );
}

function RoomForm({
  title,
  name,
  password,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  name: string;
  password: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string, password: string) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftPassword, setDraftPassword] = useState(password);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await onSubmit(draftName.trim(), draftPassword.trim());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не получилось сохранить");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label>
          Название
          <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={60} required autoFocus />
        </label>
        <div className="field">
          <span>Пароль</span>
          <span className="inline-field">
            <input aria-label="Пароль" value={draftPassword} onChange={(event) => setDraftPassword(event.target.value)} minLength={4} maxLength={40} required />
            <button type="button" className="btn ghost" onClick={() => setDraftPassword(suggestPassword())}>
              Придумать
            </button>
          </span>
        </div>
        <p className="hint">Пароль легко продиктовать. Регистр букв важен.</p>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : submitLabel}
        </button>
      </form>
    </Dialog>
  );
}

function suggestPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  let word = "";
  for (let index = 0; index < 5; index += 1) word += alphabet[bytes[index] % alphabet.length];
  return `${word}${10 + (bytes[5] % 90)}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
