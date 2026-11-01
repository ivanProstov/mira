import type { BoardItem, ItemType, Op } from "../types";

export const STICKY_COLORS = ["#fff3a8", "#ffd0e0", "#c8f0dc", "#d5e4ff", "#ffe0c2", "#eee2ff"];
export const SHAPE_COLORS = ["#ffffff00", "#fff3a8", "#ffd0e0", "#c8f0dc", "#d5e4ff", "#ffffff"];
export const INK_COLORS = ["#1c1915", "#16382c", "#1f7ad6", "#d64545", "#e07a2f", "#7a45c4"];
export const MARKER_WIDTH = 22;
export const MARKER_OPACITY = 0.5;

const RESIZABLE = new Set<ItemType>(["sticky", "text", "rect", "ellipse", "image", "frame"]);

export function canResize(type: ItemType): boolean {
  return RESIZABLE.has(type);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundItem(item: BoardItem): BoardItem {
  const next: BoardItem = {
    ...item,
    x: round2(item.x),
    y: round2(item.y),
    w: round2(item.w),
    h: round2(item.h),
    z: Math.round(item.z),
  };
  if (item.points) next.points = item.points.map(round2);
  if (item.fontSize) next.fontSize = round2(item.fontSize);
  if (item.strokeWidth) next.strokeWidth = round2(item.strokeWidth);
  if (item.opacity != null) next.opacity = round2(item.opacity);
  return next;
}

export function applyOp(items: BoardItem[], op: Op): BoardItem[] {
  if (op.type === "delete") return items.filter((item) => item.id !== op.id);
  if (op.type === "upsert") return upsert(items, op.item);
  return op.items.reduce(upsert, items);
}

function upsert(items: BoardItem[], item: BoardItem): BoardItem[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

export function topZ(items: BoardItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.z), 0) + 1;
}

export function bounds(item: BoardItem): { x: number; y: number; w: number; h: number } {
  if (item.type === "arrow") {
    const x2 = item.x + item.w;
    const y2 = item.y + item.h;
    const pad = 12;
    return {
      x: Math.min(item.x, x2) - pad,
      y: Math.min(item.y, y2) - pad,
      w: Math.abs(item.w) + pad * 2,
      h: Math.abs(item.h) + pad * 2,
    };
  }
  if ((item.type === "pen" || item.type === "highlight") && item.points && item.points.length >= 2) {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let index = 0; index < item.points.length; index += 2) {
      minX = Math.min(minX, item.points[index]);
      maxX = Math.max(maxX, item.points[index]);
      minY = Math.min(minY, item.points[index + 1]);
      maxY = Math.max(maxY, item.points[index + 1]);
    }
    return {
      x: item.x + minX,
      y: item.y + minY,
      w: Math.max(8, maxX - minX),
      h: Math.max(8, maxY - minY),
    };
  }
  return { x: item.x, y: item.y, w: Math.max(1, item.w), h: Math.max(1, item.h) };
}

export function makeBox(type: ItemType, x: number, y: number, w: number, h: number, z: number): BoardItem {
  const id = crypto.randomUUID();
  if (type === "sticky") {
    return { id, type, x, y, w, h, z, fill: "#fff3a8", text: "", fontSize: 16 };
  }
  if (type === "text") {
    return { id, type, x, y, w, h, z, text: "", fill: "#1c1915", fontSize: 22 };
  }
  if (type === "frame") {
    return { id, type, x, y, w, h, z, text: "Раздел", fill: "#ffffff99", stroke: "#16382c", strokeWidth: 2 };
  }
  if (type === "ellipse") {
    return { id, type, x, y, w, h, z, fill: "#ffffff00", stroke: "#16382c", strokeWidth: 2 };
  }
  return { id, type: "rect", x, y, w, h, z, fill: "#ffffff00", stroke: "#16382c", strokeWidth: 2 };
}
