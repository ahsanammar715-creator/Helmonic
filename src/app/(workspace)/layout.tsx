import Sidebar from "@/components/Sidebar";
import MobileTabBar from "@/components/MobileTabBar";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-surface text-ink">
      <Sidebar />
      <div className="flex-1 min-w-0 overflow-y-auto pb-14 md:pb-0">{children}</div>
      <MobileTabBar />
    </div>
  );
}
