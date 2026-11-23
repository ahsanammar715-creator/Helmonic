import type { ReactNode } from "react";

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function paragraphLines(block: string, keyPrefix: string) {
  return block.split("\n").map((line, index) => (
    <span key={`${keyPrefix}-${index}`}>
      {index > 0 && <br />}
      {inlineMarkdown(line, `${keyPrefix}-${index}`)}
    </span>
  ));
}

export default function MarkdownAnswer({ answer }: { answer: string }) {
  const blocks = answer.trim().split(/\n\s*\n/g);

  return (
    <div className="flex flex-col gap-3 text-[14px] leading-[1.7]">
      {blocks.map((block, blockIndex) => {
        const key = `answer-block-${blockIndex}`;
        const lines = block.split("\n").map((line) => line.trimEnd());
        const heading = lines.length === 1 ? lines[0].match(/^(#{1,4})\s+(.+)$/) : null;

        if (heading) {
          const level = heading[1].length;
          const className =
            level === 1
              ? "text-[18px] font-semibold"
              : level === 2
                ? "text-[16px] font-semibold"
                : "text-[14px] font-semibold";
          return (
            <p key={key} className={`m-0 ${className}`}>
              {inlineMarkdown(heading[2], key)}
            </p>
          );
        }

        const unordered = lines.every((line) => /^[-*]\s+/.test(line));
        if (unordered) {
          return (
            <ul key={key} className="m-0 list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={`${key}-${lineIndex}`}>
                  {inlineMarkdown(line.replace(/^[-*]\s+/, ""), `${key}-${lineIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line));
        if (ordered) {
          return (
            <ol key={key} className="m-0 list-decimal space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={`${key}-${lineIndex}`}>
                  {inlineMarkdown(line.replace(/^\d+[.)]\s+/, ""), `${key}-${lineIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key} className="m-0">
            {paragraphLines(block, key)}
          </p>
        );
      })}
    </div>
  );
}
