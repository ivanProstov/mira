import type { Room, SessionUser, UploadResult } from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Не получилось выполнить запрос";
    throw new ApiError(response.status, detail);
  }
  return data as T;
}

export const api = {
  me: () => request<SessionUser>("/api/me"),
  login: (username: string, password: string) =>
    request<SessionUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  rooms: () => request<{ rooms: Room[] }>("/api/rooms"),
  createRoom: (name: string, password: string) =>
    request<Room>("/api/rooms", { method: "POST", body: JSON.stringify({ name, password }) }),
  updateRoom: (id: string, patch: { name?: string; password?: string }) =>
    request<Room>(`/api/rooms/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRoom: (id: string) => request<void>(`/api/rooms/${id}`, { method: "DELETE" }),
  room: (id: string) => request<Room>(`/api/rooms/${id}`),
  enter: (id: string, name: string) =>
    request<Room>(`/api/rooms/${id}/enter`, { method: "POST", body: JSON.stringify({ name }) }),
  join: (name: string, password: string) =>
    request<Room>("/api/rooms/join", { method: "POST", body: JSON.stringify({ name, password }) }),
  upload: (roomId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<UploadResult>(`/api/rooms/${roomId}/files`, { method: "POST", body });
  },
};

export function fileUrl(id: string): string {
  return `/api/files/${id}`;
}

const NAME_KEY = "mira-display-name";

export function loadDisplayName(fallback = ""): string {
  return localStorage.getItem(NAME_KEY) || fallback;
}

export function saveDisplayName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}
