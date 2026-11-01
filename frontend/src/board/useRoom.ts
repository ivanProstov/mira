import { useCallback, useEffect, useRef, useState } from "react";
import { applyOp, roundItem } from "./model";
import type { BoardItem, Cursor, Op, Peer, TextMark, View, You } from "../types";

type Status = "connecting" | "live" | "off";

export function useRoom(roomId: string, displayName: string) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [textMarks, setTextMarks] = useState<TextMark[]>([]);
  const [you, setYou] = useState<You | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [notice, setNotice] = useState("");

  const itemsRef = useRef<BoardItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef<Map<string, Op>>(new Map());
  const views = useRef<Record<string, View>>({});
  const youId = useRef("");
  const nameRef = useRef(displayName);
  const handlerRef = useRef<(message: Message) => void>(() => {});
  const throttleTimer = useRef(0);
  const waitingOp = useRef<Op | null>(null);
  const cursorTimer = useRef(0);
  const cursorWaiting = useRef<{ x: number; y: number } | null>(null);
  const viewTimer = useRef(0);
  const viewWaiting = useRef<View | null>(null);
  const cursorBuf = useRef<Record<string, Cursor | null>>({});
  const cursorFrame = useRef(0);
  const selTimer = useRef(0);
  const selWaiting = useRef<{ itemId: string; start: number; end: number } | null>(null);
  const selSent = useRef("");

  nameRef.current = displayName;

  const applyLocal = useCallback((op: Op) => {
    setItems((prev) => {
      const next = applyOp(prev, op);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const sendRaw = useCallback((data: object) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  }, []);

  const remember = useCallback((opId: string, op: Op) => {
    if (op.type === "upsert") {
      for (const [id, previous] of pending.current) {
        if (previous.type === "upsert" && previous.item.id === op.item.id) pending.current.delete(id);
      }
    }
    if (op.type === "delete") {
      for (const [id, previous] of pending.current) {
        if (
          (previous.type === "upsert" && previous.item.id === op.id) ||
          (previous.type === "delete" && previous.id === op.id)
        ) {
          pending.current.delete(id);
        }
      }
    }
    pending.current.set(opId, op);
  }, []);

  const transmit = useCallback(
    (op: Op) => {
      const opId = crypto.randomUUID();
      remember(opId, op);
      sendRaw({ type: "op", opId, op });
    },
    [remember, sendRaw],
  );

  const preview = useCallback(
    (op: Op) => {
      applyLocal(op.type === "delete" ? op : normalizeOp(op));
    },
    [applyLocal],
  );

  const publish = useCallback(
    (op: Op) => {
      const clean = op.type === "delete" ? op : normalizeOp(op);
      applyLocal(clean);
      if (throttleTimer.current) {
        window.clearTimeout(throttleTimer.current);
        throttleTimer.current = 0;
        waitingOp.current = null;
      }
      transmit(clean);
    },
    [applyLocal, transmit],
  );

  const publishThrottled = useCallback(
    (op: Op) => {
      const clean = normalizeOp(op);
      applyLocal(clean);
      waitingOp.current = clean;
      if (throttleTimer.current) return;
      throttleTimer.current = window.setTimeout(() => {
        throttleTimer.current = 0;
        const waiting = waitingOp.current;
        waitingOp.current = null;
        if (waiting) transmit(waiting);
      }, 45);
    },
    [applyLocal, transmit],
  );

  const sendCursor = useCallback(
    (point: { x: number; y: number } | null) => {
      if (point === null) {
        if (cursorTimer.current) window.clearTimeout(cursorTimer.current);
        cursorTimer.current = 0;
        cursorWaiting.current = null;
        sendRaw({ type: "cursor", x: null, y: null });
        return;
      }
      cursorWaiting.current = point;
      if (cursorTimer.current) return;
      cursorTimer.current = window.setTimeout(() => {
        cursorTimer.current = 0;
        const waiting = cursorWaiting.current;
        if (!waiting) return;
        sendRaw({ type: "cursor", x: roundItemCoord(waiting.x), y: roundItemCoord(waiting.y) });
      }, 30);
    },
    [sendRaw],
  );

  const sendTextSel = useCallback(
    (sel: { itemId: string; start: number; end: number } | null) => {
      if (sel === null) {
        if (selTimer.current) window.clearTimeout(selTimer.current);
        selTimer.current = 0;
        selWaiting.current = null;
        if (selSent.current === "") return;
        selSent.current = "";
        sendRaw({ type: "textsel", itemId: null });
        return;
      }
      selWaiting.current = sel;
      if (selTimer.current) return;
      selTimer.current = window.setTimeout(() => {
        selTimer.current = 0;
        const waiting = selWaiting.current;
        if (!waiting) return;
        const next = `${waiting.itemId}:${waiting.start}:${waiting.end}`;
        if (next === selSent.current) return;
        selSent.current = next;
        sendRaw({ type: "textsel", itemId: waiting.itemId, start: waiting.start, end: waiting.end });
      }, 40);
    },
    [sendRaw],
  );

  const sendViewport = useCallback(
    (view: View) => {
      viewWaiting.current = view;
      if (viewTimer.current) return;
      viewTimer.current = window.setTimeout(() => {
        viewTimer.current = 0;
        const waiting = viewWaiting.current;
        if (!waiting) return;
        sendRaw({ type: "viewport", x: waiting.x, y: waiting.y, zoom: waiting.zoom });
      }, 40);
    },
    [sendRaw],
  );

  handlerRef.current = (message) => {
    if (message.type === "hello") {
      youId.current = message.you.connId;
      setYou(message.you);
      setStatus("live");
      setItems(() => {
        let next = message.items;
        for (const op of pending.current.values()) next = applyOp(next, op);
        itemsRef.current = next;
        return next;
      });
      const people = message.peers
        .filter((peer) => peer.connId !== message.you.connId)
        .map((peer) => ({ ...peer, viewport: views.current[peer.connId] || peer.viewport }));
      setPeers(people);
      setTextMarks(marksFrom(people));
      for (const [opId, op] of pending.current) sendRaw({ type: "op", opId, op });
      if (nameRef.current.trim()) sendRaw({ type: "name", name: nameRef.current.trim() });
      return;
    }
    if (message.type === "peers") {
      const people = message.peers
        .filter((peer) => peer.connId !== youId.current)
        .map((peer) => ({ ...peer, viewport: views.current[peer.connId] || peer.viewport }));
      setPeers(people);
      const alive = new Set(message.peers.map((peer) => peer.connId));
      setTextMarks((prev) => prev.filter((mark) => alive.has(mark.connId)));
      setCursors((prev) => {
        const next: Record<string, Cursor> = {};
        for (const [id, cursor] of Object.entries(prev)) {
          if (alive.has(id) && id !== youId.current) next[id] = cursor;
        }
        return next;
      });
      return;
    }
    if (message.type === "cursor") {
      if (message.connId === youId.current) return;
      cursorBuf.current[message.connId] =
        message.x == null || message.y == null
          ? null
          : {
              connId: message.connId,
              x: message.x,
              y: message.y,
              name: message.name || "",
              color: message.color || "#1f7ad6",
              role: message.role || "student",
            };
      if (!cursorFrame.current) {
        cursorFrame.current = window.requestAnimationFrame(() => {
          cursorFrame.current = 0;
          const batch = cursorBuf.current;
          cursorBuf.current = {};
          setCursors((prev) => {
            const next = { ...prev };
            for (const [id, cursor] of Object.entries(batch)) {
              if (cursor == null) delete next[id];
              else next[id] = cursor;
            }
            return next;
          });
        });
      }
      return;
    }
    if (message.type === "textsel") {
      if (message.connId === youId.current) return;
      setTextMarks((prev) => {
        const rest = prev.filter((mark) => mark.connId !== message.connId);
        if (!message.itemId || message.start == null || message.end == null) return rest;
        return [
          ...rest,
          {
            connId: message.connId,
            itemId: message.itemId,
            start: message.start,
            end: message.end,
            name: message.name || "",
            color: message.color || "#1f7ad6",
          },
        ];
      });
      return;
    }
    if (message.type === "viewport") {
      const view = { x: message.x, y: message.y, zoom: message.zoom };
      views.current[message.connId] = view;
      setPeers((current) =>
        current.map((peer) => (peer.connId === message.connId ? { ...peer, viewport: view } : peer)),
      );
      return;
    }
    if (message.type === "op") {
      if (message.opId && pending.current.has(message.opId)) pending.current.delete(message.opId);
      else applyLocal(message.op);
      return;
    }
    if (message.type === "resync") {
      pending.current.clear();
      setItems(() => {
        itemsRef.current = message.items;
        return message.items;
      });
      if (message.message) setNotice(message.message);
      return;
    }
    if (message.type === "error" && message.message) setNotice(message.message);
  };

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    let attempt = 0;

    const connect = () => {
      if (stopped) return;
      setStatus(attempt === 0 ? "connecting" : "off");
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws/${roomId}`);
      wsRef.current = socket;
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(String(event.data)) as Message);
        } catch (error) {
          console.error(error);
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        attempt += 1;
        setStatus("off");
        retry = window.setTimeout(connect, Math.min(4000, 400 * attempt));
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      window.clearTimeout(throttleTimer.current);
      window.clearTimeout(cursorTimer.current);
      window.clearTimeout(viewTimer.current);
      window.clearTimeout(selTimer.current);
      if (cursorFrame.current) window.cancelAnimationFrame(cursorFrame.current);
      socket?.close();
      wsRef.current = null;
    };
  }, [roomId]);

  useEffect(() => {
    if (status === "live" && displayName.trim()) {
      sendRaw({ type: "name", name: displayName.trim() });
    }
  }, [displayName, sendRaw, status]);

  return {
    items,
    itemsRef,
    peers,
    cursors,
    you,
    status,
    notice,
    setNotice,
    preview,
    publish,
    publishThrottled,
    sendCursor,
    sendViewport,
    textMarks,
    sendTextSel,
  };
}

function marksFrom(peers: Peer[]): TextMark[] {
  return peers.flatMap((peer) =>
    peer.textSel
      ? [{ connId: peer.connId, name: peer.name, color: peer.color, ...peer.textSel }]
      : [],
  );
}

function roundItemCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeOp(op: Op): Op {
  if (op.type === "delete") return op;
  if (op.type === "upsert") return { type: "upsert", item: roundItem(op.item) };
  return { type: "upsert_many", items: op.items.map(roundItem) };
}

type Message =
  | { type: "hello"; you: You; items: BoardItem[]; peers: Peer[] }
  | { type: "peers"; peers: Peer[] }
  | {
      type: "cursor";
      connId: string;
      x: number | null;
      y: number | null;
      name?: string;
      color?: string;
      role?: Peer["role"];
    }
  | { type: "textsel"; connId: string; itemId: string | null; start?: number; end?: number; name?: string; color?: string }
  | { type: "viewport"; connId: string; x: number; y: number; zoom: number }
  | { type: "op"; opId?: string; op: Op }
  | { type: "resync"; items: BoardItem[]; message?: string }
  | { type: "error"; message?: string };
