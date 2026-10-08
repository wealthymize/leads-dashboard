export function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]) {
  const lines = [headers, ...rows].map((line) => line.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}
