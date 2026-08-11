import EqualizerIcon from "./EqualizerIcon";

/** The Helmonic brand mark: the equalizer glyph with a soft sonar ripple. */
export default function HelmonicMark({ size = 26, iconSize = 14 }: { size?: number; iconSize?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s]" />
      <span className="absolute inset-0 rounded-full border border-primary animate-ping [animation-duration:2.2s] [animation-delay:1.1s]" />
      <span className="relative z-10 flex items-center justify-center w-full h-full bg-primary rounded-md text-white">
        <EqualizerIcon size={iconSize} />
      </span>
    </span>
  );
}
