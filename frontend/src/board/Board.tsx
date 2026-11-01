import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import { Avatar, Dialog, Wordmark } from "../ui";
import type { BoardItem, Op, Peer, Room, UploadResult, View } from "../types";
import { ItemBody } from "./ItemView";
import { INK_COLORS, MARKER_OPACITY, MARKER_WIDTH, SHAPE_COLORS, STICKY_COLORS, bounds, canResize, clamp, makeBox, topZ } from "./model";
import { useRoom } from "./useRoom";

type Tool = "select" | "hand" | "sticky" | "text" | "frame" | "rect" | "ellipse" | "arrow" | "pen" | "highlight";

type Point = { x: number; y: number };

type Gesture =
  | { kind: "pan"; pointer: number; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; pointer: number; id: string; sx: number; sy: number; origins: BoardItem[]; latest: BoardItem[]; moved: boolean; editOnClick: boolean; additive: boolean; wasSelected: boolean }
  | { kind: "resize"; pointer: number; id: string; corner: string; sx: number; sy: number; origin: BoardItem; latest: BoardItem }
  | { kind: "box"; pointer: number; id: string; tool: "rect" | "ellipse" | "frame"; ax: number; ay: number }
  | { kind: "arrow"; pointer: number; id: string; ax: number; ay: number }
  | { kind: "pen"; pointer: number; id: string; tool: "pen" | "highlight"; points: Point[]; stroke: string; strokeWidth: number; opacity?: number };

const TOOLS: { id: Tool; icon: "select" | "hand" | "sticky" | "text" | "frame" | "rect" | "ellipse" | "arrow" | "pen" | "marker"; label: string; key: string }[] = [
  { id: "select", icon: "select", label: "Указатель", key: "V" },
  { id: "hand", icon: "hand", label: "Рука — двигать доску", key: "H" },
  { id: "sticky", icon: "sticky", label: "Заметка", key: "N" },
  { id: "text", icon: "text", label: "Текст", key: "T" },
  { id: "frame", icon: "frame", label: "Рамка раздела", key: "F" },
  { id: "rect", icon: "rect", label: "Прямоугольник", key: "R" },
  { id: "ellipse", icon: "ellipse", label: "Эллипс", key: "E" },
  { id: "arrow", icon: "arrow", label: "Стрелка", key: "L" },
  { id: "pen", icon: "pen", label: "Карандаш", key: "P" },
  { id: "highlight", icon: "marker", label: "Маркер", key: "M" },
];

function toolHint(tool: Tool): string {
  if (tool === "sticky") return "Нажмите на доску — появится заметка";
  if (tool === "text") return "Нажмите на доску — появится текст";
  if (tool === "frame" || tool === "rect" || tool === "ellipse" || tool === "arrow") return "Нажмите или протяните по доске";
  if (tool === "pen") return "Ведите карандашом по доске";
  if (tool === "highlight") return "Закрасьте нужное место";
  if (tool === "hand") return "Зажмите и тяните, чтобы двигать доску";
  return "";
}

type Props = {
  room: Room;
  role: "tutor" | "student";
  displayName: string;
  onRename: (name: string) => void;
  onRoom: (room: Room) => void;
};

export function Board({ room, role, displayName, onRename, onRoom }: Props) {
  const roomApi = useRoom(room.id, displayName);
  const { items, itemsRef, peers, cursors, you, status, notice, setNotice, preview, publish, publishThrottled, sendCursor, sendViewport } = roomApi;
  const [view, setView] = useState<View>({ x: 90, y: 70, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  const [showPeople, setShowPeople] = useState(() => window.matchMedia("(min-width: 981px)").matches);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [editor, setEditor] = useState(false);
  const [draftName, setDraftName] = useState(room.name);
  const [draftPassword, setDraftPassword] = useState(room.password || "");
  const [saving, setSaving] = useState(false);
  const [markerWidth, setMarkerWidth] = useState(MARKER_WIDTH);
  const [markerOpacity, setMarkerOpacity] = useState(MARKER_OPACITY);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  const toolRef = useRef(tool);
  const spaceRef = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const history = useRef<Op[][]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const inside = useRef(false);
  const moveRef = useRef<(event: PointerEvent) => void>(() => {});
  const upRef = useRef<(event: PointerEvent) => void>(() => {});
  const localViewRef = useRef<(next: View) => void>(() => {});
  const selectedRef = useRef<string[]>([]);
  const markerRef = useRef({ width: MARKER_WIDTH, opacity: MARKER_OPACITY });
  const markerOrigin = useRef<BoardItem | null>(null);
  const editingRef = useRef<string | null>(null);
  const addFilesRef = useRef<(files: File[], at?: Point) => void>(() => {});

  viewRef.current = view;
  toolRef.current = tool;
  markerRef.current = { width: markerWidth, opacity: markerOpacity };
  selectedRef.current = selectedIds;
  editingRef.current = editingId;

  const setLocalView = useCallback(
    (next: View) => {
      setFollowing(null);
      setView(next);
      sendViewport(next);
    },
    [sendViewport],
  );
  localViewRef.current = setLocalView;

  const worldFrom = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    const current = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left - current.x) / current.zoom,
      y: (event.clientY - rect.top - current.y) / current.zoom,
    };
  }, []);

  const center = useCallback((): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    const current = viewRef.current;
    if (!rect) return { x: 400, y: 300 };
    return {
      x: (rect.width / 2 - current.x) / current.zoom,
      y: (rect.height / 2 - current.y) / current.zoom,
    };
  }, []);

  const remember = useCallback((batch: Op[]) => {
    history.current.push(batch);
    if (history.current.length > 80) history.current.splice(0, history.current.length - 80);
  }, []);

  const onText = useCallback(
    (id: string, text: string) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item || item.text === text) return;
      publishThrottled({ type: "upsert", item: { ...item, text } });
    },
    [itemsRef, publishThrottled],
  );

  const onTextHeight = useCallback(
    (id: string, height: number) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item || Math.abs(item.h - height) < 4) return;
      publishThrottled({ type: "upsert", item: { ...item, h: height } });
    },
    [itemsRef, publishThrottled],
  );

  const onEditing = useCallback((id: string, next: boolean) => {
    setEditingId((current) => (next ? id : current === id ? null : current));
  }, []);

  const removeSelected = useCallback(() => {
    const found = selectedRef.current.flatMap((id) => {
      const item = itemsRef.current.find((entry) => entry.id === id);
      return item ? [item] : [];
    });
    if (!found.length) return;
    remember(found.map((item) => ({ type: "upsert" as const, item })));
    for (const item of found) publish({ type: "delete", id: item.id });
    setSelectedIds([]);
    setEditingId(null);
  }, [itemsRef, publish, remember]);

  const addFiles = useCallback(
    async (files: File[], at?: Point) => {
      const accepted = files.filter((file) => file.size > 0);
      if (!accepted.length) return;
      setBusy(accepted.some((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) ? "Готовим страницы…" : "Загружаем…");
      setNotice("");
      try {
        let anchor = at || center();
        let align: "center" | "left" = "center";
        for (const file of accepted) {
          const result = await api.upload(room.id, file);
          const placed = layoutUpload(result, file.name, anchor, itemsRef.current, align);
          if (!placed.length) continue;
          publish({ type: "upsert_many", items: placed });
          remember(placed.map((item) => ({ type: "delete", id: item.id })));
          const maxX = Math.max(...placed.map((item) => item.x + item.w));
          const minY = Math.min(...placed.map((item) => item.y));
          anchor = { x: maxX + 48, y: minY };
          align = "left";
        }
        setTool("select");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Не удалось загрузить файл");
      } finally {
        setBusy("");
      }
    },
    [center, itemsRef, publish, remember, room.id, setNotice],
  );
  addFilesRef.current = (files, at) => {
    void addFiles(files, at);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => moveRef.current(event);
    const up = (event: PointerEvent) => upRef.current(event);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = viewRef.current;
      const rect = stage.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const worldX = (sx - current.x) / current.zoom;
        const worldY = (sy - current.y) / current.zoom;
        const zoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0016), 0.12, 3);
        localViewRef.current({ zoom, x: sx - worldX * zoom, y: sy - worldY * zoom });
        return;
      }
      localViewRef.current({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (status === "live") sendViewport(viewRef.current);
  }, [sendViewport, status]);

  useEffect(() => {
    if (!following) return;
    const peer = peers.find((item) => item.connId === following);
    if (!peer) {
      setFollowing(null);
      return;
    }
    if (!peer.viewport) return;
    const next = peer.viewport;
    setView((current) => (current.x === next.x && current.y === next.y && current.zoom === next.zoom ? current : next));
  }, [following, peers]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input")) return;
      if (event.code === "Space") {
        event.preventDefault();
        spaceRef.current = true;
        setSpace(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        const batch = history.current.pop();
        if (!batch) return;
        for (const op of batch) publish(op);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const found = selectedRef.current.flatMap((id) => {
          const item = itemsRef.current.find((entry) => entry.id === id);
          return item ? [item] : [];
        });
        if (!found.length) return;
        const base = topZ(itemsRef.current);
        const copies = found.map((item, index) => ({ ...item, id: crypto.randomUUID(), x: item.x + 28, y: item.y + 28, z: base + index }));
        publish({ type: "upsert_many", items: copies });
        remember(copies.map((item) => ({ type: "delete" as const, id: item.id })));
        setSelectedIds(copies.map((item) => item.id));
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const shortcut = event.key.toLowerCase();
      const nextTool = TOOLS.find((entry) => entry.key.toLowerCase() === shortcut);
      if (nextTool) {
        setTool(nextTool.id);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedRef.current.length && !editingRef.current) {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === "Enter" && selectedRef.current.length === 1) {
        const item = itemsRef.current.find((entry) => entry.id === selectedRef.current[0]);
        if (item && (item.type === "text" || item.type === "frame" || item.type === "sticky")) {
          setEditingId(item.id);
          setTool("select");
        }
        return;
      }
      if (!selectedRef.current.length || editingRef.current) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const found = selectedRef.current.flatMap((id) => {
        const item = itemsRef.current.find((entry) => entry.id === id);
        return item ? [item] : [];
      });
      if (!found.length) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      publish({ type: "upsert_many", items: found.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy })) });
      remember([{ type: "upsert_many", items: found }]);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [itemsRef, publish, remember, removeSelected]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input")) return;
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      addFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  moveRef.current = (event) => {
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    const overStage = Boolean(
      rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
    );
    if (overStage) {
      inside.current = true;
      sendCursor(worldFrom(event));
    } else if (inside.current && !gesture.current) {
      inside.current = false;
      sendCursor(null);
    }
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.kind === "pan") {
      setLocalView({
        x: current.vx + event.clientX - current.sx,
        y: current.vy + event.clientY - current.sy,
        zoom: viewRef.current.zoom,
      });
      return;
    }
    const world = worldFrom(event);
    const zoom = viewRef.current.zoom || 1;
    if (current.kind === "move") {
      const dx = (event.clientX - current.sx) / zoom;
      const dy = (event.clientY - current.sy) / zoom;
      if (!current.moved && Math.hypot(event.clientX - current.sx, event.clientY - current.sy) < 4) return;
      current.moved = true;
      const moving = new Set(current.origins.map((item) => item.id));
      const maxOther = itemsRef.current.reduce((max, item) => (moving.has(item.id) ? max : Math.max(max, item.z)), 0);
      const order = [...current.origins].sort((a, b) => a.z - b.z);
      const zOf = new Map(order.map((item, index) => [item.id, item.type === "frame" ? item.z : maxOther + 1 + index]));
      const next = current.origins.map((origin) => ({
        ...origin,
        x: origin.x + dx,
        y: origin.y + dy,
        z: zOf.get(origin.id) ?? origin.z,
      }));
      current.latest = next;
      publishThrottled({ type: "upsert_many", items: next });
      return;
    }
    if (current.kind === "resize") {
      const dx = (event.clientX - current.sx) / zoom;
      const dy = (event.clientY - current.sy) / zoom;
      const next = resizeItem(current.origin, current.corner, dx, dy);
      current.latest = next;
      publishThrottled({ type: "upsert", item: next });
      return;
    }
    if (current.kind === "box") {
      const item = itemsRef.current.find((entry) => entry.id === current.id);
      if (!item) return;
      preview({
        type: "upsert",
        item: {
          ...item,
          x: Math.min(current.ax, world.x),
          y: Math.min(current.ay, world.y),
          w: Math.abs(world.x - current.ax),
          h: Math.abs(world.y - current.ay),
        },
      });
      return;
    }
    if (current.kind === "arrow") {
      const item = itemsRef.current.find((entry) => entry.id === current.id);
      if (!item) return;
      preview({ type: "upsert", item: { ...item, w: world.x - current.ax, h: world.y - current.ay } });
      return;
    }
    if (current.kind !== "pen") return;
    let last = current.points[current.points.length - 1];
    let grew = false;
    for (const point of eventPoints(event, worldFrom)) {
      if (Math.hypot(point.x - last.x, point.y - last.y) < 0.65) continue;
      current.points.push(point);
      last = point;
      grew = true;
    }
    if (grew) publishThrottled({ type: "upsert", item: strokeItem(current.id, current.tool, current.points, itemsRef.current, current) });
  };

  upRef.current = (event) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (current.kind === "pan") return;
    if (current.kind === "move") {
      if (!current.moved) {
        if (current.additive && current.wasSelected) {
          setSelectedIds((ids) => ids.filter((itemId) => itemId !== current.id));
          return;
        }
        if (!current.additive && current.origins.length > 1) {
          setSelectedIds([current.id]);
          return;
        }
        if (current.editOnClick) setEditingId(current.id);
        return;
      }
      publish({ type: "upsert_many", items: current.latest });
      remember([{ type: "upsert_many", items: current.origins }]);
      return;
    }
    if (current.kind === "resize") {
      publish({ type: "upsert", item: current.latest });
      remember([{ type: "upsert", item: current.origin }]);
      return;
    }
    if (current.kind === "box") {
      const item = itemsRef.current.find((entry) => entry.id === current.id);
      if (!item) return;
      let final = item;
      if (item.w < 8 && item.h < 8) {
        const w = current.tool === "frame" ? 760 : current.tool === "ellipse" ? 150 : 180;
        const h = current.tool === "frame" ? 460 : current.tool === "ellipse" ? 150 : 120;
        final = { ...item, x: current.ax - w / 2, y: current.ay - h / 2, w, h };
      }
      publish({ type: "upsert", item: final });
      remember([{ type: "delete", id: final.id }]);
      setSelectedIds([final.id]);
      if (current.tool === "frame") setEditingId(final.id);
      setTool("select");
      return;
    }
    if (current.kind === "arrow") {
      const item = itemsRef.current.find((entry) => entry.id === current.id);
      if (!item || Math.hypot(item.w, item.h) < 8) {
        preview({ type: "delete", id: current.id });
        return;
      }
      publish({ type: "upsert", item });
      remember([{ type: "delete", id: item.id }]);
      setSelectedIds([item.id]);
      return;
    }
    let points = current.points;
    if (points.length < 2) points = [points[0], { x: points[0].x + 0.8, y: points[0].y + 0.8 }];
    const item = strokeItem(current.id, current.tool, points, itemsRef.current, current);
    publish({ type: "upsert", item });
    remember([{ type: "delete", id: item.id }]);
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 2) return;
    const stage = stageRef.current;
    if (!stage) return;
    const target = event.target as HTMLElement;
    if (target.closest(".selection-bar, .zoom-controls, .follow-banner, .toast")) return;
    const typing = Boolean(target.closest("textarea, input"));
    const itemEl = target.closest("[data-item]") as HTMLElement | null;
    const world = worldFrom(event);
    if (spaceRef.current || toolRef.current === "hand" || event.button === 1) {
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const current = viewRef.current;
      gesture.current = { kind: "pan", pointer: event.pointerId, sx: event.clientX, sy: event.clientY, vx: current.x, vy: current.y };
      setPanning(true);
      return;
    }
    if (toolRef.current === "select") {
      if (!itemEl) {
        setSelectedIds([]);
        setEditingId(null);
        return;
      }
      const id = itemEl.dataset.item || "";
      const item = itemsRef.current.find((entry) => entry.id === id);
      if (!item) return;
      const additive = event.metaKey || event.ctrlKey;
      const wasSelected = selectedRef.current.includes(id);
      const ids = additive ? (wasSelected ? selectedRef.current : [...selectedRef.current, id]) : wasSelected ? selectedRef.current : [id];
      setSelectedIds(ids);
      if (typing && !additive) {
        setEditingId(id);
        return;
      }
      const editOnClick = item.type === "text" && !additive && ids.length === 1;
      if (editOnClick && event.detail >= 2) {
        setEditingId(id);
        return;
      }
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const handle = target.dataset.handle || target.closest<HTMLElement>("[data-handle]")?.dataset.handle || "";
      if (handle && canResize(item.type) && ids.length === 1) {
        gesture.current = { kind: "resize", pointer: event.pointerId, id, corner: handle, sx: event.clientX, sy: event.clientY, origin: item, latest: item };
        return;
      }
      setEditingId((current) => (!additive && current === id ? current : null));
      const origins = ids.flatMap((itemId) => {
        const entry = itemsRef.current.find((candidate) => candidate.id === itemId);
        return entry ? [entry] : [];
      });
      gesture.current = { kind: "move", pointer: event.pointerId, id, sx: event.clientX, sy: event.clientY, origins, latest: origins, moved: false, editOnClick, additive, wasSelected };
      return;
    }
    if (typing) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    const active = toolRef.current;
    const z = topZ(itemsRef.current);
    if (active === "sticky" || active === "text") {
      const w = active === "sticky" ? 210 : 260;
      const h = active === "sticky" ? 156 : 48;
      const item = makeBox(active, world.x - w / 2, world.y - 18, w, h, z);
      publish({ type: "upsert", item });
      remember([{ type: "delete", id: item.id }]);
      setSelectedIds([item.id]);
      setEditingId(item.id);
      setTool("select");
      return;
    }
    if (active === "pen" || active === "highlight") {
      const stroke = active === "highlight" ? "#f2c84b" : "#1c1915";
      const strokeWidth = active === "highlight" ? markerRef.current.width : 2.5;
      const opacity = active === "highlight" ? markerRef.current.opacity : undefined;
      const item: BoardItem = {
        id: crypto.randomUUID(),
        type: active,
        x: world.x,
        y: world.y,
        w: 1,
        h: 1,
        z,
        points: [0, 0],
        stroke,
        strokeWidth,
        opacity,
      };
      preview({ type: "upsert", item });
      gesture.current = { kind: "pen", pointer: event.pointerId, id: item.id, tool: active, points: [world], stroke, strokeWidth, opacity };
      return;
    }
    if (active === "arrow") {
      const item: BoardItem = {
        id: crypto.randomUUID(),
        type: "arrow",
        x: world.x,
        y: world.y,
        w: 0,
        h: 0,
        z,
        stroke: "#16382c",
        strokeWidth: 2.5,
      };
      preview({ type: "upsert", item });
      gesture.current = { kind: "arrow", pointer: event.pointerId, id: item.id, ax: world.x, ay: world.y };
      return;
    }
    if (active === "rect" || active === "ellipse" || active === "frame") {
      const item = makeBox(active, world.x, world.y, 1, 1, z);
      preview({ type: "upsert", item });
      gesture.current = { kind: "box", pointer: event.pointerId, id: item.id, tool: active, ax: world.x, ay: world.y };
    }
  }

  function onMarkerEdit(patch: { strokeWidth?: number; opacity?: number }, phase: "start" | "live" | "end") {
    if (patch.strokeWidth != null) setMarkerWidth(patch.strokeWidth);
    if (patch.opacity != null) setMarkerOpacity(patch.opacity);
    const id = selectedRef.current.length === 1 ? selectedRef.current[0] : "";
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || item.type !== "highlight") return;
    if (phase === "start") {
      markerOrigin.current = item;
      return;
    }
    if (phase === "end") {
      const before = markerOrigin.current;
      markerOrigin.current = null;
      const latest = itemsRef.current.find((entry) => entry.id === id);
      if (!before || !latest) return;
      if (latest.strokeWidth === before.strokeWidth && (latest.opacity ?? MARKER_OPACITY) === (before.opacity ?? MARKER_OPACITY)) return;
      publish({ type: "upsert", item: latest });
      remember([{ type: "upsert", item: before }]);
      return;
    }
    publishThrottled({ type: "upsert", item: { ...item, ...patch } });
  }

  function fit() {
    const stage = stageRef.current;
    const list = itemsRef.current;
    if (!stage) return;
    if (!list.length) {
      setLocalView({ x: 90, y: 70, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of list) {
      const box = bounds(item);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    }
    const rect = stage.getBoundingClientRect();
    const pad = 72;
    const zoom = clamp(Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2)), 0.12, 2);
    setLocalView({
      zoom,
      x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (rect.height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  }

  function pick(accept: string) {
    const input = fileRef.current;
    if (!input || busy) return;
    input.accept = accept;
    input.click();
  }

  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      const updated = await api.updateRoom(room.id, { name: draftName, password: draftPassword });
      onRoom(updated);
      setEditor(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось сохранить комнату");
    } finally {
      setSaving(false);
    }
  }

  async function copyPassword() {
    if (!room.password) return;
    try {
      await navigator.clipboard.writeText(room.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setNotice("Не удалось скопировать пароль");
    }
  }

  const selected = selectedIds.length === 1 ? items.find((item) => item.id === selectedIds[0]) || null : null;
  const followed = peers.find((peer) => peer.connId === following) || null;
  const sorted = [...items].sort((a, b) => a.z - b.z);
  const statusLabel = status === "live" ? "На связи" : status === "off" ? "Переподключение…" : "Подключаемся…";

  return (
    <div className={`board-shell ${showPeople ? "show-people" : ""}`}>
      <header className="board-header">
        <Wordmark linked />
        <div className="room-heading">
          <strong>{room.name}</strong>
          {role === "tutor" && room.password && (
            <button type="button" className="password-chip" onClick={() => void copyPassword()}>
              {copied ? "Скопирован" : room.password}
            </button>
          )}
          {role === "tutor" && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setDraftName(room.name);
                setDraftPassword(room.password || "");
                setEditor(true);
              }}
            >
              Изменить
            </button>
          )}
        </div>
        <div className="header-side">
          <span className={`presence ${status}`}>
            <i />
            {statusLabel}
          </span>
          <button type="button" className={`btn ghost slim ${showPeople ? "on" : ""}`} onClick={() => setShowPeople((value) => !value)}>
            {peers.length + 1} на доске
          </button>
        </div>
      </header>

      <aside className="toolbar">
        <div className="toolbar-rail">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tool ${tool === entry.id ? "active" : ""}`}
            aria-pressed={tool === entry.id}
            aria-label={`${entry.label}, клавиша ${entry.key}`}
            title={`${entry.label} (${entry.key})`}
            onClick={() => setTool(entry.id)}
          >
            <Icon name={entry.icon} />
          </button>
        ))}
        <div className="tool-gap" />
        <button type="button" className="tool" title="Картинка" aria-label="Картинка" disabled={Boolean(busy)} onClick={() => pick("image/png,image/jpeg,image/gif,image/webp")}>
          <Icon name="image" />
        </button>
        <button type="button" className="tool" title="PDF учебника" aria-label="PDF учебника" disabled={Boolean(busy)} onClick={() => pick("application/pdf")}>
          <Icon name="pdf" />
        </button>
        </div>
        <p className="tool-now">{TOOLS.find((entry) => entry.id === tool)?.label}</p>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(event) => {
            const list = [...(event.target.files || [])];
            event.target.value = "";
            if (list.length) void addFiles(list);
          }}
        />
      </aside>

      <div
        ref={stageRef}
        className={`stage ${panning ? "panning" : ""} ${over ? "over" : ""} ${space ? "space" : ""}`}
        data-tool={tool}
        style={{
          ["--grid" as string]: `${22 * view.zoom}px`,
          ["--grid-x" as string]: `${view.x}px`,
          ["--grid-y" as string]: `${view.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerLeave={() => {
          if (!gesture.current) {
            inside.current = false;
            sendCursor(null);
          }
        }}
        onDoubleClick={(event) => {
          const itemEl = (event.target as HTMLElement).closest("[data-item]") as HTMLElement | null;
          if (!itemEl) return;
          const item = itemsRef.current.find((entry) => entry.id === itemEl.dataset.item);
          if (!item) return;
          if (item.type === "text" || item.type === "frame" || item.type === "sticky") {
            setSelectedIds([item.id]);
            setEditingId(item.id);
            setTool("select");
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void addFiles([...(event.dataTransfer.files || [])], worldFrom(event));
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="world" data-interactive={tool === "select" && !space ? "true" : "false"} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {sorted.map((item) => {
            const box = bounds(item);
            return (
              <div
                key={item.id}
                data-item={item.id}
                className={`item ${selectedIds.includes(item.id) ? "selected" : ""} item-${item.type}`}
                style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h, zIndex: item.z }}
              >
                <ItemBody item={item} editing={editingId === item.id} onText={onText} onTextHeight={onTextHeight} onEditing={onEditing} />
                {selectedIds.length === 1 && selectedIds[0] === item.id && canResize(item.type) &&
                  (["nw", "ne", "sw", "se"] as const).map((corner) => (
                    <span
                      key={corner}
                      data-handle={corner}
                      className={`handle ${corner}`}
                      style={{ transform: `scale(${1 / view.zoom})` }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
        <div className="cursor-layer">
          {Object.values(cursors).map((cursor) => (
            <div key={cursor.connId} className="live-cursor" style={{ transform: `translate(${cursor.x * view.zoom + view.x}px, ${cursor.y * view.zoom + view.y}px)` }}>
              <svg viewBox="0 0 18 18" className="pointer">
                <path d="M2 1.5l5.2 14 1.7-5.2 5.6-1.6L2 1.5z" fill={cursor.color} />
              </svg>
              <span className={cursor.role === "tutor" ? "with-avatar" : ""} style={{ background: cursor.color }}>
                {cursor.role === "tutor" && <Avatar className="tiny" />}
                {cursor.name}
                {cursor.role === "tutor" ? " · репетитор" : ""}
              </span>
            </div>
          ))}
        </div>
        {!items.length && !busy && (
          <div className="empty-board">
            <strong>Здесь начнётся занятие</strong>
            <p>Заметка, текст и маркер — на панели слева. Учебник можно просто перетащить на доску.</p>
          </div>
        )}
        {toolHint(tool) && !followed && (
          <div className="place-hint">{toolHint(tool)}</div>
        )}
        {(selected || selectedIds.length > 1) && (
          <div
            className="selection-bar"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest("input")) return;
              event.preventDefault();
            }}
          >
            {selectedIds.length > 1 && <span className="selection-count">{selectedIds.length} выбрано</span>}
            {selected && <Palette item={selected} onPick={(patch) => {
              const before = selected;
              publish({ type: "upsert", item: { ...selected, ...patch } });
              remember([{ type: "upsert", item: before }]);
            }} />}
            {selected?.type === "highlight" && tool !== "highlight" && (
              <MarkerSliders
                width={selected.strokeWidth || MARKER_WIDTH}
                opacity={selected.opacity ?? MARKER_OPACITY}
                onEdit={onMarkerEdit}
              />
            )}
            {selected && (selected.type === "sticky" || selected.type === "text") && (
              <span className="font-size">
                <button type="button" onClick={() => changeFont(selected, -2, publish, remember)}>A−</button>
                <button type="button" onClick={() => changeFont(selected, 2, publish, remember)}>A+</button>
              </span>
            )}
            <button type="button" className="btn danger slim" onClick={() => removeSelected()}>
              Удалить
            </button>
          </div>
        )}
        {tool === "highlight" && (
          <div
            className={`selection-bar marker-bar${selected ? " shifted" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest("input")) return;
              event.preventDefault();
            }}
          >
            <MarkerSliders
              width={markerWidth}
              opacity={markerOpacity}
              onEdit={(patch) => {
                if (patch.strokeWidth != null) setMarkerWidth(patch.strokeWidth);
                if (patch.opacity != null) setMarkerOpacity(patch.opacity);
              }}
            />
          </div>
        )}
        {followed && (
          <div className="follow-banner">
            <Icon name="eye" />
            <span>Смотрите глазами: {followed.name}</span>
            <button type="button" onClick={() => setFollowing(null)}>Открепиться</button>
          </div>
        )}
        {(busy || notice) && <div className={`toast ${notice ? "bad" : ""}`}>{busy || notice}</div>}
        <div className="zoom-controls">
          <button type="button" title="Мельче" onClick={() => zoomAround(view, stageRef.current, 1 / 1.12, setLocalView)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="zoom-label" onClick={() => setLocalView({ ...view, zoom: 1 })}>
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" title="Крупнее" onClick={() => zoomAround(view, stageRef.current, 1.12, setLocalView)}>
            <Icon name="plus" />
          </button>
          <button type="button" title="Показать всё" onClick={fit}>
            <Icon name="fit" />
          </button>
        </div>
      </div>

      <aside className="people">
        <div className="people-head">
          <h2>В комнате</h2>
          <p>Курсоры видны всем. «Смотреть» переносит вас к экрану этого человека.</p>
        </div>
        <label className="name-field">
          Ваше имя
          <input value={displayName} maxLength={40} onChange={(event) => onRename(event.target.value)} />
        </label>
        <div className="you-row">
          {role === "tutor" ? <Avatar /> : <i style={{ background: you?.color || "#0f6b4c" }} />}
          <span>{displayName || "Вы"}</span>
          <em>{role === "tutor" ? "репетитор" : "это вы"}</em>
        </div>
        <ul>
          {peers.map((peer) => (
            <PeerRow key={peer.connId} peer={peer} active={following === peer.connId} onFollow={() => setFollowing((current) => (current === peer.connId ? null : peer.connId))} />
          ))}
        </ul>
        {!peers.length && <p className="people-empty">Пока на доске только вы. Когда ученик войдёт, здесь появится его имя.</p>}
      </aside>

      {editor && role === "tutor" && (
        <Dialog title="Комната" onClose={() => setEditor(false)}>
          <form onSubmit={(event) => void saveRoom(event)} className="stack">
            <label>
              Название
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={60} required />
            </label>
            <label>
              Пароль для учеников
              <input value={draftPassword} onChange={(event) => setDraftPassword(event.target.value)} minLength={4} maxLength={40} required />
            </label>
            <p className="hint">Ученики, которые уже внутри, останутся. Новый пароль нужен только чтобы войти.</p>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function PeerRow({ peer, active, onFollow }: { peer: Peer; active: boolean; onFollow: () => void }) {
  return (
    <li>
      {peer.role === "tutor" ? <Avatar /> : <i style={{ background: peer.color }} />}
      <span>
        {peer.name}
        {peer.role === "tutor" ? <em> репетитор</em> : null}
      </span>
      <button type="button" className={active ? "active" : ""} onClick={onFollow}>
        {active ? "Открепиться" : "Смотреть"}
      </button>
    </li>
  );
}

function MarkerSliders({
  width,
  opacity,
  onEdit,
}: {
  width: number;
  opacity: number;
  onEdit: (patch: { strokeWidth?: number; opacity?: number }, phase: "start" | "live" | "end") => void;
}) {
  const shown = Math.round(opacity * 100);
  return (
    <span className="marker-controls">
      <span>
        Толщина
        <input
          type="range"
          min={8}
          max={56}
          step={1}
          value={Math.round(width)}
          aria-label="Толщина маркера"
          onPointerDown={() => onEdit({}, "start")}
          onChange={(event) => onEdit({ strokeWidth: Number(event.target.value) }, "live")}
          onPointerUp={() => onEdit({}, "end")}
        />
      </span>
      <span>
        Прозрачность
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={shown}
          aria-label="Прозрачность маркера"
          onPointerDown={() => onEdit({}, "start")}
          onChange={(event) => onEdit({ opacity: Number(event.target.value) / 100 }, "live")}
          onPointerUp={() => onEdit({}, "end")}
        />
        <em>{shown}%</em>
      </span>
    </span>
  );
}

function Palette({ item, onPick }: { item: BoardItem; onPick: (patch: Partial<BoardItem>) => void }) {
  const strokeMode = item.type === "pen" || item.type === "highlight" || item.type === "arrow";
  const colors = item.type === "sticky" ? STICKY_COLORS : strokeMode ? INK_COLORS : item.type === "text" ? INK_COLORS : SHAPE_COLORS;
  const current = strokeMode ? item.stroke : item.fill;
  return (
    <span className="swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={current === color ? "active" : ""}
          style={{ background: color === "#ffffff00" ? "linear-gradient(135deg, transparent 46%, #8d2f2f 48%, #8d2f2f 52%, transparent 54%), #fff" : color }}
          aria-label={color}
          onClick={() => onPick(strokeMode ? { stroke: color } : { fill: color })}
        />
      ))}
    </span>
  );
}

function changeFont(item: BoardItem, delta: number, publish: (op: Op) => void, remember: (batch: Op[]) => void) {
  const fontSize = clamp((item.fontSize || 16) + delta, 12, 64);
  publish({ type: "upsert", item: { ...item, fontSize } });
  remember([{ type: "upsert", item }]);
}

function zoomAround(view: View, stage: HTMLDivElement | null, factor: number, setLocalView: (view: View) => void) {
  const rect = stage?.getBoundingClientRect();
  const zoom = clamp(view.zoom * factor, 0.12, 3);
  if (!rect) {
    setLocalView({ ...view, zoom });
    return;
  }
  const sx = rect.width / 2;
  const sy = rect.height / 2;
  const worldX = (sx - view.x) / view.zoom;
  const worldY = (sy - view.y) / view.zoom;
  setLocalView({ zoom, x: sx - worldX * zoom, y: sy - worldY * zoom });
}

function eventPoints(event: PointerEvent, toWorld: (point: { clientX: number; clientY: number }) => Point): Point[] {
  const native = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
  return native.map((entry) => toWorld(entry));
}

function strokeItem(
  id: string,
  type: "pen" | "highlight",
  points: Point[],
  items: BoardItem[],
  style?: { stroke: string; strokeWidth: number; opacity?: number },
): BoardItem {
  const existing = items.find((item) => item.id === id);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const flat: number[] = [];
  for (const point of points) flat.push(point.x - minX, point.y - minY);
  return {
    id,
    type,
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
    z: existing?.z ?? 1,
    points: flat,
    stroke: style?.stroke || existing?.stroke || (type === "highlight" ? "#f2c84b" : "#1c1915"),
    strokeWidth: style?.strokeWidth || existing?.strokeWidth || (type === "highlight" ? MARKER_WIDTH : 2.5),
    opacity: type === "highlight" ? (style?.opacity ?? existing?.opacity ?? MARKER_OPACITY) : undefined,
  };
}

function resizeItem(origin: BoardItem, corner: string, dx: number, dy: number): BoardItem {
  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;
  if (corner.includes("e")) w = origin.w + dx;
  if (corner.includes("s")) h = origin.h + dy;
  if (corner.includes("w")) {
    w = origin.w - dx;
    x = origin.x + dx;
  }
  if (corner.includes("n")) {
    h = origin.h - dy;
    y = origin.y + dy;
  }
  if (origin.type === "text") {
    h = origin.h;
    y = origin.y;
  }
  const minW = origin.type === "frame" ? 180 : origin.type === "text" ? 80 : 48;
  const minH = origin.type === "frame" ? 120 : origin.type === "text" ? 36 : 40;
  if (origin.type === "image" && origin.w > 0 && origin.h > 0) {
    const ratio = origin.w / origin.h;
    if (corner === "e" || corner === "w") h = w / ratio;
    else h = w / ratio;
  }
  if (w < minW) {
    if (corner.includes("w")) x -= minW - w;
    w = minW;
  }
  if (h < minH) {
    if (corner.includes("n")) y -= minH - h;
    h = minH;
  }
  return { ...origin, x, y, w, h };
}

function layoutUpload(result: UploadResult, name: string, origin: Point, existing: BoardItem[], align: "center" | "left"): BoardItem[] {
  const pages = result.kind === "pdf" ? result.pages : [result.file];
  const columns = result.kind === "pdf" ? Math.min(3, pages.length) : 1;
  const sized = pages.map((page) => {
    const w = result.kind === "pdf" ? 820 : Math.min(900, page.width);
    return { id: page.id, w, h: w * (page.height / Math.max(page.width, 1)) };
  });
  const rows: (typeof sized)[] = [];
  for (let index = 0; index < sized.length; index += columns) rows.push(sized.slice(index, index + columns));
  const gap = 36;
  const rowHeights = rows.map((row) => Math.max(...row.map((page) => page.h)));
  const blockH = rowHeights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, rows.length - 1);
  let y = align === "center" ? origin.y - blockH / 2 : origin.y;
  const z = topZ(existing);
  const placed: BoardItem[] = [];
  rows.forEach((row, rowIndex) => {
    const rowW = row.reduce((sum, page) => sum + page.w, 0) + gap * Math.max(0, row.length - 1);
    let x = align === "center" ? origin.x - rowW / 2 : origin.x;
    row.forEach((page) => {
      placed.push({
        id: crypto.randomUUID(),
        type: "image",
        x,
        y,
        w: page.w,
        h: page.h,
        z: z + placed.length,
        src: page.id,
        alt: name,
      });
      x += page.w + gap;
    });
    y += rowHeights[rowIndex] + gap;
  });
  return placed;
}
