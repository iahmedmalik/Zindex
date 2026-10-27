// Builds a CSV file that opens cleanly in Excel. Every cell is quoted when it needs to be, and a cell
// that starts with = + - @ (which a spreadsheet would run as a formula) is defused with a leading
// apostrophe, so a customer name can never become a formula on the owner's computer.
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The byte-order mark makes Excel read the file as UTF-8.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
