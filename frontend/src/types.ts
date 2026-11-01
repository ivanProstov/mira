export type Role = "tutor" | "student";

export type SessionUser = {
  role: Role;
  name: string;
  userId: string;
};

export type Room = {
  id: string;
  name: string;
  password?: string;
  createdAt: string;
  updatedAt: string;
  yourName?: string;
};

export type ItemType =
  | "sticky"
  | "text"
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "highlight"
  | "image"
  | "frame";

export type BoardItem = {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  points?: number[];
  src?: string;
  alt?: string;
};

export type Op =
  | { type: "upsert"; item: BoardItem }
  | { type: "upsert_many"; items: BoardItem[] }
  | { type: "delete"; id: string };

export type TextMark = {
  connId: string;
  itemId: string;
  start: number;
  end: number;
  name: string;
  color: string;
};

export type Peer = {
  connId: string;
  name: string;
  role: Role;
  color: string;
  viewport: View | null;
  textSel?: { itemId: string; start: number; end: number } | null;
};

export type View = {
  x: number;
  y: number;
  zoom: number;
};

export type Cursor = {
  connId: string;
  x: number;
  y: number;
  name: string;
  color: string;
  role: Role;
};

export type You = {
  connId: string;
  name: string;
  role: Role;
  color: string;
};

export type UploadResult =
  | { kind: "image"; file: { id: string; width: number; height: number; name: string } }
  | { kind: "pdf"; pages: { id: string; width: number; height: number }[] };
