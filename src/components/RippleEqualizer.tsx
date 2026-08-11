/** The Helmonic mark's gradient orb with sonar ripples — used in the prompt bar. */
export default function RippleEqualizer({ size = 26 }: { size?: number }) {
  const pad = size * 0.6;
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size + pad, height: size + pad, margin: -pad / 2 }}
    >
      <span className="absolute inset-0 rounded-full border-2 border-primary radiate-ring [animation-delay:0s]" />
      <span className="absolute inset-0 rounded-full border-2 border-primary radiate-ring [animation-delay:0.8s]" />
      <span className="absolute inset-0 rounded-full border-2 border-primary radiate-ring [animation-delay:1.6s]" />
      <span
        className="relative z-10 rounded-full shrink-0 animate-pulse-glow"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, var(--color-primary), var(--color-violet))",
        }}
      />
    </span>
  );
}
