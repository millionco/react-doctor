import { GREEN_COLOR, RED_COLOR } from "../constants";
import type { ThreeFinding } from "../three-constants";

export interface ThreeFindingRowProps {
  finding: ThreeFinding;
  fixProgress: number;
  opacity: number;
}

export const ThreeFindingRow = ({ finding, fixProgress, opacity }: ThreeFindingRowProps) => (
  <div
    className="three-finding-row"
    style={{
      borderColor: fixProgress > 0.5 ? "rgba(74, 222, 128, 0.28)" : "rgba(248, 113, 113, 0.24)",
      opacity,
      transform: `translateY(${(1 - opacity) * 18}px)`,
    }}
  >
    <span
      className="three-finding-status"
      style={{
        backgroundColor: fixProgress > 0.5 ? GREEN_COLOR : RED_COLOR,
        color: fixProgress > 0.5 ? "#052e16" : "#450a0a",
      }}
    >
      {fixProgress > 0.5 ? "✓" : "!"}
    </span>
    <div className="three-finding-copy">
      <div
        className="three-finding-title"
        style={{ color: fixProgress > 0.5 ? GREEN_COLOR : undefined }}
      >
        {finding.title}
      </div>
      <div className="three-finding-detail">{finding.detail}</div>
    </div>
    <span className="three-finding-file">{finding.file}</span>
  </div>
);
