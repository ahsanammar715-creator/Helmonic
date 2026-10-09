import path from "node:path";

import { strFromU8, unzipSync } from "fflate";

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function attribute(xml: string, name: string) {
  return xml.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`, "i"))?.[1];
}

function textRuns(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function sharedStrings(archive: Record<string, Uint8Array>) {
  const bytes = archive["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)]
    .map((match) => textRuns(match[1]));
}

function firstWorksheetPath(archive: Record<string, Uint8Array>) {
  const workbookBytes = archive["xl/workbook.xml"];
  const relationshipBytes = archive["xl/_rels/workbook.xml.rels"];
  if (workbookBytes && relationshipBytes) {
    const workbook = strFromU8(workbookBytes);
    const relationshipId = workbook.match(/<sheet\b[^>]*\br:id=["']([^"']+)["'][^>]*>/i)?.[1];
    if (relationshipId) {
      const relationships = strFromU8(relationshipBytes);
      const entries = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)];
      const target = entries
        .map((match) => match[1])
        .find((attrs) => attribute(attrs, "Id") === relationshipId);
      const relationshipTarget = target && attribute(target, "Target");
      if (relationshipTarget) {
        const normalized = relationshipTarget.startsWith("/")
          ? relationshipTarget.slice(1)
          : path.posix.normalize(path.posix.join("xl", relationshipTarget));
        if (archive[normalized]) return normalized;
      }
    }
  }
  return Object.keys(archive)
    .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/i.test(name))
    .sort()[0];
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  return [...letters].reduce((index, letter) => (index * 26) + letter.charCodeAt(0) - 64, 0) - 1;
}

function excelDate(value: string) {
  const serial = Number.parseFloat(value);
  if (!Number.isFinite(serial)) return value;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10);
}

function csvValue(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function xlsxFirstSheetToCsv(bytes: Uint8Array, maxUncompressedBytes = 50 * 1024 * 1024) {
  const archive = unzipSync(bytes);
  const uncompressedBytes = Object.values(archive).reduce((total, entry) => total + entry.byteLength, 0);
  if (uncompressedBytes > maxUncompressedBytes) {
    throw new Error(`XLSX expands to ${uncompressedBytes} bytes; configured safety maximum is ${maxUncompressedBytes}.`);
  }
  const worksheetPath = firstWorksheetPath(archive);
  if (!worksheetPath) throw new Error("XLSX contains no worksheet.");
  const worksheet = strFromU8(archive[worksheetPath]);
  const strings = sharedStrings(archive);
  const rows = [...worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attribute(attrs, "r") ?? "";
      const index = columnIndex(reference);
      if (index < 0) continue;
      const type = attribute(attrs, "t") ?? "n";
      const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      row[index] = type === "s"
        ? strings[Number.parseInt(raw, 10)] ?? ""
        : type === "inlineStr"
          ? textRuns(body)
          : type === "b"
            ? raw === "1" ? "true" : "false"
            : decodeXml(raw);
    }
    return row;
  });
  if (rows.length === 0) throw new Error("XLSX first worksheet contains no rows.");
  const width = Math.max(...rows.map((row) => row.length));
  const headers = Array.from({ length: width }, (_unused, index) => rows[0][index] ?? "");
  return rows.map((row, rowIndex) => Array.from({ length: width }, (_unused, index) => {
    const value = row[index] ?? "";
    const header = headers[index].toLowerCase();
    const normalized = rowIndex > 0 && /(?:^|_)date$/.test(header) && /^\d+(?:\.\d+)?$/.test(value)
      ? excelDate(value)
      : value;
    return csvValue(normalized);
  }).join(",")).join("\n");
}
