const dateFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });
const fullFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Short, list-friendly timestamp: time for today, date otherwise. */
export function formatShort(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return timeFormatter.format(date);
  if (date.getFullYear() === now.getFullYear()) return dateFormatter.format(date);
  return fullFormatter.format(date);
}

export function formatFull(timestamp: number): string {
  return fullFormatter.format(new Date(timestamp));
}

/** First non-empty line after the title, used as the list preview. */
export function snippet(content: string): string {
  const lines = content.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) return '';
  const rest = lines
    .slice(firstIndex + 1)
    .find((line) => line.trim().length > 0);
  return (rest ?? '').trim().slice(0, 120);
}
