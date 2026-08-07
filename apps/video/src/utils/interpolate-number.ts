export interface InterpolateNumberInput {
  easing?: (progress: number) => number;
  inputEnd: number;
  inputStart: number;
  outputEnd: number;
  outputStart: number;
  value: number;
}

export const interpolateNumber = ({
  easing = (progress) => progress,
  inputEnd,
  inputStart,
  outputEnd,
  outputStart,
  value,
}: InterpolateNumberInput) => {
  const duration = inputEnd - inputStart;
  const rawProgress = duration === 0 ? 1 : (value - inputStart) / duration;
  const progress = Math.min(1, Math.max(0, rawProgress));
  return outputStart + (outputEnd - outputStart) * easing(progress);
};
