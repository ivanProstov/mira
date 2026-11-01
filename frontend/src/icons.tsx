import type { ReactNode } from "react";

type IconName =
  | "select"
  | "hand"
  | "sticky"
  | "text"
  | "frame"
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "marker"
  | "image"
  | "pdf"
  | "trash"
  | "eye"
  | "plus"
  | "minus"
  | "fit";

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {paths[name]}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const paths: Record<IconName, ReactNode> = {
  select: <path {...stroke} d="M5 4l6.2 15.2 2.2-5.6L19 11.2 5 4z" />,
  hand: <path {...stroke} d="M8 11V6.5a1.3 1.3 0 0 1 2.6 0V11M10.6 10V5.2a1.3 1.3 0 0 1 2.6 0V11M13.2 10.2V6.4a1.3 1.3 0 0 1 2.6 0V13M8 11.2c-.8.7-2 2.3-2 4.2C6 18.4 8 20 11.2 20h2.2c2.6 0 4.6-1.6 4.6-4.4V11.2a1.2 1.2 0 0 0-2.4 0" />,
  sticky: <path {...stroke} d="M7 5.5h8.2L18.5 9v9.5h-11.5v-13zM15 5.6V9h3.3" />,
  text: <path {...stroke} d="M6 6.5h12M12 6.5V18M9 18h6" />,
  frame: <path {...stroke} d="M6 7.5h12v10H6zM6 7.5V5.8M18 7.5V5.8" />,
  rect: <path {...stroke} d="M6 7h12v10H6z" />,
  ellipse: <ellipse {...stroke} cx="12" cy="12" rx="6.5" ry="5" />,
  arrow: <path {...stroke} d="M6 17L17 7M11.5 6.5H17.5V12.5" />,
  pen: <path {...stroke} d="M13.2 6.2l4.6 4.6L9 19.6H4.4V15z" />,
  marker: <path {...stroke} d="M5 16.5c3-1 4.2-3.2 6.2-6.2l2.2-2.4a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-2.4 2.2c-3 2-5.2 3.2-6.2 6.2H5v-3.4z" />,
  image: (
    <>
      <path {...stroke} d="M5 7.5h14v10H5z" />
      <path {...stroke} d="M5 15l3.4-3 2.4 2.2L14 11l5 4.2" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  pdf: (
    <>
      <path {...stroke} d="M8 4.5h6l4 4V19.5H8z" />
      <path {...stroke} d="M14 4.7V8.5h3.7M10 13.2h4.2M10 16h3" />
    </>
  ),
  trash: <path {...stroke} d="M8 8.5h8l-.6 10H8.6L8 8.5zM6.5 8.5h11M10 5.5h4M10.5 11.5v4M13.5 11.5v4" />,
  eye: (
    <>
      <path {...stroke} d="M3.5 12S6.8 7.2 12 7.2 20.5 12 20.5 12 17.2 16.8 12 16.8 3.5 12 3.5 12z" />
      <circle {...stroke} cx="12" cy="12" r="2.1" />
    </>
  ),
  plus: <path {...stroke} d="M12 6v12M6 12h12" />,
  minus: <path {...stroke} d="M6 12h12" />,
  fit: <path {...stroke} d="M8 5.5H5.5V8M16 5.5h2.5V8M8 18.5H5.5V16M16 18.5h2.5V16" />,
};
