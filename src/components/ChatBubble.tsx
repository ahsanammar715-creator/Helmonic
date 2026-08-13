import HelmonicMark from "./HelmonicMark";

export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 max-w-[900px] justify-end ml-auto">
      <div className="border border-line rounded-md bg-surface px-3.5 py-2.5 text-[14px]">
        {children}
      </div>
      <span className="shrink-0 w-8 h-8 rounded-full bg-primary-tint-2 border border-line text-sub flex items-center justify-center text-[11px] font-semibold">
        JD
      </span>
    </div>
  );
}

export function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3.5 max-w-[900px]">
      <span className="shrink-0">
        <HelmonicMark size={30} iconSize={17} />
      </span>
      <div className="flex-1 border border-line rounded-md bg-surface px-4.5 py-4 flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}
