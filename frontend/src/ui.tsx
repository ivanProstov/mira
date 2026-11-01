import type { ReactNode } from "react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import roman from "./assets/roman.jpg";

export function Avatar({ className = "" }: { className?: string }) {
  return <img className={`avatar ${className}`.trim()} src={roman} alt="" />;
}

export function Wordmark({ linked = false }: { linked?: boolean }) {
  const body = (
    <>
      <span className="mark">M</span>
      <span className="wordmark-copy">
        Mira
        <small>доска Романа</small>
      </span>
    </>
  );
  if (linked) {
    return (
      <Link to="/app" className="wordmark">
        {body}
      </Link>
    );
  }
  return <span className="wordmark">{body}</span>;
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
