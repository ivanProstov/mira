import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fileUrl } from "../api";
import type { BoardItem, TextMark } from "../types";
import { MARKER_OPACITY, MARKER_WIDTH } from "./model";

type Props = {
  item: BoardItem;
  editing: boolean;
  marks: TextMark[];
  onText: (id: string, text: string) => void;
  onTextHeight: (id: string, height: number) => void;
  onEditing: (id: string, editing: boolean) => void;
};

export function ItemBody({ item, editing, marks, onText, onTextHeight, onEditing }: Props) {
  if (item.type === "image" && item.src) {
    return (
      <div className="item-image">
        <img src={fileUrl(item.src)} alt={item.alt || ""} draggable={false} />
      </div>
    );
  }
  if (item.type === "pen" || item.type === "highlight") return <Stroke item={item} />;
  if (item.type === "arrow") return <Arrow item={item} />;
  if (item.type === "rect" || item.type === "ellipse") {
    return (
      <div
        className="shape"
        style={{
          background: item.fill || "transparent",
          border: `${item.strokeWidth || 2}px solid ${item.stroke || "#16382c"}`,
          borderRadius: item.type === "ellipse" ? "50%" : 10,
        }}
      />
    );
  }
  if (item.type === "frame") {
    return (
      <div className="frame" style={{ background: item.fill || "#ffffff99", borderColor: item.stroke || "#16382c" }}>
        {editing ? (
          <input
            className="frame-title editing"
            value={item.text || ""}
            onChange={(event) => onText(item.id, event.target.value)}
            onBlur={() => onEditing(item.id, false)}
            autoFocus
          />
        ) : (
          <div className="frame-title">{item.text || "Раздел"}</div>
        )}
      </div>
    );
  }
  if (item.type === "text") return <TextItem item={item} editing={editing} marks={marks} onText={onText} onTextHeight={onTextHeight} onEditing={onEditing} />;
  return <Sticky item={item} editing={editing} marks={marks} onText={onText} onEditing={onEditing} />;
}

function Sticky({ item, editing, marks, onText, onEditing }: Omit<Props, "onTextHeight">) {
  const text = item.text || "";
  return (
    <div className="sticky" style={{ background: item.fill || "#fff3a8" }}>
      <div className="grip" aria-hidden="true" />
      <div className="sticky-body">
        {marks.length > 0 && (
          <div className="sel-mirror" style={{ fontSize: item.fontSize || 16 }} aria-hidden="true">
            <Marked text={text} marks={marks} />
          </div>
        )}
        <textarea
          value={text}
          aria-label="Текст заметки"
          style={{ fontSize: item.fontSize || 16 }}
          onChange={(event) => onText(item.id, event.target.value)}
          onScroll={(event) => {
            const mirror = event.currentTarget.previousElementSibling;
            if (mirror instanceof HTMLElement) mirror.scrollTop = event.currentTarget.scrollTop;
          }}
          onFocus={() => onEditing(item.id, true)}
          onBlur={() => onEditing(item.id, false)}
          autoFocus={editing}
        />
      </div>
    </div>
  );
}

function TextItem({ item, editing, marks, onText, onTextHeight, onEditing }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(item.text || "");
  const openedAt = useRef(0);
  const value = editing ? draft : item.text || "";
  const measured = value ? (value.endsWith("\n") ? `${value}\u200b` : value) : "Текст";

  useEffect(() => {
    if (!editing) setDraft(item.text || "");
  }, [editing, item.text]);

  useEffect(() => {
    if (!editing) return;
    openedAt.current = performance.now();
    const frame = requestAnimationFrame(() => fieldRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  useLayoutEffect(() => {
    const node = sizerRef.current;
    if (!node) return;
    const next = Math.ceil(node.offsetHeight) + 2;
    if (next > 0 && Math.abs(next - item.h) > 1) onTextHeight(item.id, next);
  }, [measured, item.fontSize, item.h, item.id, item.w, onTextHeight]);

  const style = { color: item.fill || "#1c1915", fontSize: item.fontSize || 22 };
  return (
    <>
      <div ref={sizerRef} className="text-body text-sizer" style={style} aria-hidden="true">
        {measured}
      </div>
      {editing && marks.length > 0 && (
        <div className="sel-mirror text-body" style={style} aria-hidden="true">
          <Marked text={draft} marks={marks} />
        </div>
      )}
      {editing ? (
        <textarea
          ref={fieldRef}
          className="plain-text text-body"
          style={style}
          rows={1}
          value={draft}
          placeholder="Текст"
          onChange={(event) => {
            setDraft(event.target.value);
            onText(item.id, event.target.value);
          }}
          onScroll={(event) => {
            const mirror = event.currentTarget.previousElementSibling;
            if (mirror instanceof HTMLElement && mirror.classList.contains("sel-mirror")) {
              mirror.scrollTop = event.currentTarget.scrollTop;
            }
          }}
          onBlur={() => {
            if (performance.now() - openedAt.current < 400) {
              requestAnimationFrame(() => fieldRef.current?.focus());
              return;
            }
            onEditing(item.id, false);
          }}
        />
      ) : (
        <div className={`plain-text text-body ${value ? "" : "muted"}`} style={style}>
          {marks.length > 0 && value ? <Marked text={value} marks={marks} /> : value || "Текст"}
        </div>
      )}
    </>
  );
}

function Marked({ text, marks }: { text: string; marks: TextMark[] }) {
  const cuts = new Set<number>([0, text.length]);
  for (const mark of marks) {
    cuts.add(Math.max(0, Math.min(text.length, mark.start)));
    cuts.add(Math.max(0, Math.min(text.length, mark.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === end) continue;
    const active = marks.filter((mark) => mark.start < end && mark.end > start);
    parts.push({ start, text: text.slice(start, end), color: active[0]?.color || "", title: active.map((mark) => mark.name).filter(Boolean).join(", ") });
  }
  return (
    <>
      {parts.map((part) =>
        part.color ? (
          <mark key={part.start} style={{ background: `${part.color}8c` }} title={part.title}>
            {part.text}
          </mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Stroke({ item }: { item: BoardItem }) {
  const points = item.points || [];
  const d = pathOf(points);
  return (
    <svg className={`stroke-svg ${item.type}`} viewBox={`0 0 ${Math.max(item.w, 1)} ${Math.max(item.h, 1)}`} width="100%" height="100%">
      <path
        d={d}
        fill="none"
        stroke={item.stroke || (item.type === "highlight" ? "#f2c84b" : "#1c1915")}
        strokeWidth={item.strokeWidth || (item.type === "highlight" ? MARKER_WIDTH : 2.5)}
        strokeOpacity={item.type === "highlight" ? (item.opacity ?? MARKER_OPACITY) : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Arrow({ item }: { item: BoardItem }) {
  const x2 = item.x + item.w;
  const y2 = item.y + item.h;
  const pad = 12;
  const left = Math.min(item.x, x2) - pad;
  const top = Math.min(item.y, y2) - pad;
  const width = Math.abs(item.w) + pad * 2;
  const height = Math.abs(item.h) + pad * 2;
  const stroke = item.stroke || "#16382c";
  const marker = `mk-${item.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg className="arrow-svg" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
      <defs>
        <marker id={marker} markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto">
          <path d="M0 0.8 L8 4 L0 7.2 Z" fill={stroke} />
        </marker>
      </defs>
      <line x1={item.x - left} y1={item.y - top} x2={x2 - left} y2={y2 - top} stroke="transparent" strokeWidth="16" />
      <line
        x1={item.x - left}
        y1={item.y - top}
        x2={x2 - left}
        y2={y2 - top}
        stroke={stroke}
        strokeWidth={item.strokeWidth || 2.5}
        strokeLinecap="round"
        markerEnd={`url(#${marker})`}
      />
    </svg>
  );
}

function pathOf(points: number[]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0]} ${points[1]}`;
  for (let index = 2; index < points.length; index += 2) {
    path += ` L ${points[index]} ${points[index + 1]}`;
  }
  return path;
}
