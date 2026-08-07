import { GREEN_COLOR, RED_COLOR } from "../constants";
import type { ThreeCodeLine } from "../three-constants";

export interface ThreeCodeCardProps {
  isOptimized: boolean;
  lines: ThreeCodeLine[];
  opacity: number;
  title: string;
}

export const ThreeCodeCard = ({ isOptimized, lines, opacity, title }: ThreeCodeCardProps) => (
  <div
    className="three-code-card"
    style={{
      borderColor: isOptimized ? "rgba(74, 222, 128, 0.24)" : "rgba(248, 113, 113, 0.24)",
      opacity,
      transform: `translateY(${(1 - opacity) * 20}px)`,
    }}
  >
    <div className="three-code-card-header">
      <span>{title}</span>
      <span style={{ color: isOptimized ? GREEN_COLOR : RED_COLOR }}>
        {isOptimized ? "STABLE" : "HOT PATH"}
      </span>
    </div>
    <pre>
      {lines.map((line, lineIndex) => (
        <span key={line.id}>
          <i>{String(lineIndex + 1).padStart(2, "0")}</i>
          {line.text || " "}
        </span>
      ))}
    </pre>
  </div>
);
