export const PRESENCE_CLASSES = [
  'presence-1',
  'presence-2',
  'presence-3',
  'presence-4',
  'presence-5',
  'presence-6',
  'presence-7',
  'presence-8',
] as const;

export function presenceClass(colorIndex: number): string {
  return PRESENCE_CLASSES[((colorIndex % 8) + 8) % 8]!;
}
