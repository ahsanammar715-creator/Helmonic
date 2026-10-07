function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return { rows, quoted };
}

function headerKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseCsv(text: string) {
  const { rows } = csvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export function parseCsvStrict(text: string) {
  const { rows, quoted } = csvRows(text);
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (rows.length === 0) throw new Error("CSV is empty.");
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  if (headers.some((header) => !header)) throw new Error("CSV contains a blank header.");
  const normalizedHeaders = headers.map(headerKey);
  const duplicate = normalizedHeaders.find((header, index) => normalizedHeaders.indexOf(header) !== index);
  if (duplicate) throw new Error("CSV contains duplicate headers after normalization.");
  return rows.slice(1).flatMap((values, index) => {
    if (!values.some((value) => value.trim())) return [];
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    }
    return [Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]))];
  });
}

export function pick(row: Record<string, string>, candidates: string[]) {
  const entries = new Map(
    Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]),
  );
  for (const candidate of candidates) {
    const value = entries.get(candidate.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value) return value;
  }
  return "";
}
