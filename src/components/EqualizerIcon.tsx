const bars = [
  { duration: "0.9s", delay: "0s" },
  { duration: "0.7s", delay: "0.15s" },
  { duration: "1.1s", delay: "0.05s" },
  { duration: "0.8s", delay: "0.25s" },
];

/** A small music-equalizer-style animated mark, used as Helmonic's "listening" motif. */
export default function EqualizerIcon({ size = 17, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-end gap-[2px] shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="eq-bar block rounded-full"
          style={{
            width: Math.max(2, size / 6),
            height: "100%",
            background: "currentColor",
            animationDuration: b.duration,
            animationDelay: b.delay,
          }}
        />
      ))}
    </span>
  );
}
