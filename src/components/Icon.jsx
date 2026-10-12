const PATHS = {
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  download: "M12 4v12m0 0 5-5m-5 5-5-5M5 20h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  zoomIn: "M11 5v12M5 11h12",
  zoomOut: "M5 11h12",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
};

export default function Icon({ name, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={name === "zoomIn" || name === "zoomOut" ? "2 2 20 20" : "0 0 24 24"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
