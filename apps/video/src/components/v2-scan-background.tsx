import {
  V2_SCAN_CONTENT_HORIZONTAL_PADDING_PX,
  V2_SCAN_CONTENT_VERTICAL_PADDING_PX,
  V2_SCANNED_ISSUES,
} from "../v2-constants";
import { V2ScanRow } from "./v2-scan-row";

export interface V2ScanBackgroundProps {
  opacity: number;
  repeatCount?: number;
  scrollY: number;
}

export const V2ScanBackground = ({ opacity, repeatCount = 1, scrollY }: V2ScanBackgroundProps) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      opacity,
      padding: `${V2_SCAN_CONTENT_VERTICAL_PADDING_PX}px ${V2_SCAN_CONTENT_HORIZONTAL_PADDING_PX}px`,
    }}
  >
    <div style={{ transform: `translateY(-${scrollY}px)` }}>
      {Array.from({ length: repeatCount }, (_, repeatIndex) =>
        V2_SCANNED_ISSUES.map((issue) => (
          <V2ScanRow key={`${repeatIndex}-${issue.message}`} issue={issue} />
        )),
      )}
    </div>
  </div>
);
