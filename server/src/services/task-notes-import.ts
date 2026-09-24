const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const header = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}:$/;

function trimBlankLines(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.join("\n");
}

function parseDate(value: string): string | null {
  const [month = "", dayPart = "", yearPart = ""] = value.slice(0, -1).replace(",", "").split(" ");
  const monthNumber = months.indexOf(month);
  const day = Number(dayPart);
  const year = Number(yearPart);
  const utc = new Date(Date.UTC(year, monthNumber, day));
  if (monthNumber < 0 || utc.getUTCFullYear() !== year || utc.getUTCMonth() !== monthNumber || utc.getUTCDate() !== day) return null;
  return `${yearPart}-${String(monthNumber + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseTaskNotes(value: string): { legacyBody: string; datedSections: { date: string; body: string }[] } {
  const legacyLines: string[] = [];
  const datedSections: { date: string; body: string }[] = [];
  let current: { date: string; body: string } | null = null;
  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    const date = header.test(line.trim()) ? parseDate(line.trim()) : null;
    if (date) {
      if (current) datedSections.push({ ...current, body: trimBlankLines(current.body) });
      current = { date, body: "" };
    } else if (current) {
      current.body = current.body ? `${current.body}\n${line}` : line;
    } else {
      legacyLines.push(line);
    }
  }
  if (current) datedSections.push({ ...current, body: trimBlankLines(current.body) });
  return { legacyBody: trimBlankLines(legacyLines.join("\n")), datedSections };
}

/** Server port of formatTriageNotesHeading: "MMM d, yyyy:" for a YYYY-MM-DD date. */
export function formatDatedNoteHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${months[(month ?? 1) - 1]} ${day}, ${year}:`;
}
