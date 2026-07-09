import { highlighter } from "@react-doctor/core";

interface BuildMeterBarInput {
  readonly fraction: number;
  readonly width: number;
  readonly colorizeFilled: (text: string) => string;
}

export const buildMeterBar = (input: BuildMeterBarInput): string => {
  const safeFraction = Number.isFinite(input.fraction)
    ? Math.max(0, Math.min(1, input.fraction))
    : 0;
  const filledCount = Math.round(safeFraction * input.width);
  const emptyCount = Math.max(0, input.width - filledCount);
  return `${input.colorizeFilled("█".repeat(filledCount))}${highlighter.dim("░".repeat(emptyCount))}`;
};
