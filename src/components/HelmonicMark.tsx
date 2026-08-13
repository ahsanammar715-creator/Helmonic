import { AudioLines } from "lucide-react";

/** The plain Helmonic brand badge, used wherever the wordmark appears (sidebar, headers). */
export default function HelmonicMark({ size = 26, iconSize = 15 }: { size?: number; iconSize?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-xl bg-primary text-white shrink-0"
      style={{ width: size, height: size }}
    >
      <AudioLines size={iconSize} strokeWidth={2} />
    </span>
  );
}
