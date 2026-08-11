import EqualizerIcon from "./EqualizerIcon";

/** The Helmonic mark's gradient badge, animated like a live equalizer with sonar ripples — used in the prompt bar. */
export default function RippleEqualizer({ size = 26, iconSize = 15 }: { size?: number; iconSize?: number }) {
  const pad = size * 0.6;
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size + pad, height: size + pad, margin: -pad / 2 }}
    >
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s]" />
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s] [animation-delay:1.1s]" />
      <span
        className="relative z-10 flex items-center justify-center rounded-xl text-white shrink-0"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, var(--color-primary), var(--color-violet))",
        }}
      >
        <EqualizerIcon size={iconSize} />
      </span>
    </span>
  );
}
