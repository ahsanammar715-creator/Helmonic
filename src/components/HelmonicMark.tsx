import { AudioWaveform } from "lucide-react";

/** The plain Helmonic brand badge, used wherever the wordmark appears (sidebar, headers). */
export default function HelmonicMark({ size = 26, iconSize = 15 }: { size?: number; iconSize?: number }) {
  return (
    <span
      className="flex items-center justify-center bg-primary rounded-md text-white shrink-0"
      style={{ width: size, height: size }}
    >
      <AudioWaveform size={iconSize} strokeWidth={1.8} />
    </span>
  );
}
