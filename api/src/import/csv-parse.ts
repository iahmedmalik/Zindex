// Reads CSV text (RFC 4180): commas, quoted cells, doubled quotes inside quotes, line breaks inside
// quoted cells, \r\n or \n line ends, and an optional byte-order mark. Returns one object per row,
// keyed by the header row. Blank lines are skipped.
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) table.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("The file ends inside a quoted cell. It may be cut off.");
  row.push(cell);
  if (row.some((c) => c !== "")) table.push(row);

  const [header, ...body] = table;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
