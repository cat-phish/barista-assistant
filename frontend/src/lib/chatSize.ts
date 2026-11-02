// Sizes for the AI chat limits (docs/api/chat.md §12), which the API keeps in
// bytes and people enter in KB, MB or GB.
export const SIZE_UNITS = ['KB', 'MB', 'GB'] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];
const BYTES: Record<SizeUnit, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

export const toBytes = (value: number, unit: SizeUnit): number => Math.round(value * BYTES[unit]);

// The largest unit it's a tidy number in.
export function fromBytes(bytes: number): { value: number; unit: SizeUnit } {
  const unit = [...SIZE_UNITS].reverse().find((u) => bytes >= BYTES[u]) ?? 'KB';
  return { value: Math.round((bytes / BYTES[unit]) * 100) / 100, unit };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const { value, unit } = fromBytes(bytes);
  return `${value} ${unit}`;
}
