import { MessageSquare, Wrench, Truck, Share2, LucideIcon } from "lucide-react";
import { WorkspaceKey } from "./data";

export const workspaceTheme: Record<
  WorkspaceKey,
  { accent: string; tint: string; icon: LucideIcon }
> = {
  consult: { accent: "var(--color-primary)", tint: "var(--color-primary-tint)", icon: MessageSquare },
  build: { accent: "var(--color-teal)", tint: "var(--color-teal-tint)", icon: Wrench },
  logistics: { accent: "var(--color-amber)", tint: "var(--color-amber-tint)", icon: Truck },
  socials: { accent: "var(--color-violet)", tint: "var(--color-violet-tint)", icon: Share2 },
};
