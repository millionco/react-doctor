// Ease-out cubic: maps 0..1 progress to an eased 0..1 value (fast start, gentle settle).
export const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;
