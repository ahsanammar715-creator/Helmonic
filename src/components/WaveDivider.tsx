export default function WaveDivider({ color = "var(--color-line)" }: { color?: string }) {
  return (
    <svg
      width="100%"
      height="6"
      viewBox="0 0 200 6"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block"
    >
      <path
        d="M0 3 C 8 0, 17 0, 25 3 S 42 6, 50 3 S 67 0, 75 3 S 92 6, 100 3 S 117 0, 125 3 S 142 6, 150 3 S 167 0, 175 3 S 192 6, 200 3"
        fill="none"
        stroke={color}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
