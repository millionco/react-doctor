import { formatDuration } from "./format-duration.ts";

interface ElapsedLabelProps {
  milliseconds: number;
}

// Existing consumer (keeps format-duration.ts reachable). Do not edit.
export const ElapsedLabel = ({ milliseconds }: ElapsedLabelProps) => (
  <span className="elapsed">{formatDuration(milliseconds)}</span>
);
