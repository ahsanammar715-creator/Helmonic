import EqualizerIcon from "./EqualizerIcon";

/** The prompt bar's live equalizer bars, with a sonar ripple radiating outward. */
export default function RippleEqualizer({ size = 17, className = "" }: { size?: number; className?: string }) {
  const pad = size * 0.7;
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size + pad, height: size + pad, margin: -pad / 2 }}
    >
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s]" />
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s] [animation-delay:1.1s]" />
      <EqualizerIcon size={size} className={`relative z-10 ${className}`} />
    </span>
  );
}
