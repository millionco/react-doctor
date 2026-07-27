import { BACKGROUND_COLOR, WHITE_COLOR } from "../constants";
import { V2ScanRow } from "../components/v2-scan-row";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  V2_SCAN_CONTENT_HORIZONTAL_PADDING_PX,
  V2_SCAN_CONTENT_VERTICAL_PADDING_PX,
  V2_SCAN_FONT_SIZE_PX,
  V2_SCAN_FRAMES_PER_ISSUE,
  V2_SCAN_LINE_HEIGHT,
  V2_SCAN_OVERLAY_HEIGHT_PX,
  V2_SCAN_OVERLAY_HORIZONTAL_PADDING_PX,
  V2_SCAN_OVERLAY_TOP_PADDING_PX,
  V2_SCAN_ROW_FADE_DURATION_FRAMES,
  V2_SCAN_ROW_VERTICAL_PADDING_PX,
  V2_SCAN_SCROLL_DISTANCE_RATIO,
  V2_SCAN_SCROLL_REFERENCE_FRAMES,
  V2_SCAN_SCROLL_START_FRAME,
  V2_SCAN_TITLE_FADE_DURATION_FRAMES,
  V2_SCAN_TITLE_FADE_START_FRAME,
  V2_SCAN_TITLE_FONT_SIZE_PX,
  V2_SCANNED_ISSUES,
} from "../v2-constants";
import { FONT_FAMILY } from "../constants";

export interface V2FileScanProps {
  frame: number;
}

const scanRowHeightPixels =
  V2_SCAN_FONT_SIZE_PX * V2_SCAN_LINE_HEIGHT + V2_SCAN_ROW_VERTICAL_PADDING_PX * 2;
const scanHeightPixels = V2_SCANNED_ISSUES.length * scanRowHeightPixels;
const scanScrollPixelsPerFrame =
  (scanHeightPixels * V2_SCAN_SCROLL_DISTANCE_RATIO) / V2_SCAN_SCROLL_REFERENCE_FRAMES;

export const V2FileScan = ({ frame }: V2FileScanProps) => {
  const scrollY = Math.max(0, frame - V2_SCAN_SCROLL_START_FRAME) * scanScrollPixelsPerFrame;
  const titleOpacity = interpolateNumber({
    value: frame,
    inputStart: V2_SCAN_TITLE_FADE_START_FRAME,
    inputEnd: V2_SCAN_TITLE_FADE_START_FRAME + V2_SCAN_TITLE_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });

  return (
    <div className="scene" style={{ backgroundColor: BACKGROUND_COLOR }}>
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          padding: `${V2_SCAN_CONTENT_VERTICAL_PADDING_PX}px ${V2_SCAN_CONTENT_HORIZONTAL_PADDING_PX}px`,
        }}
      >
        <div style={{ transform: `translateY(-${scrollY}px)` }}>
          {V2_SCANNED_ISSUES.map((issue, issueIndex) => (
            <V2ScanRow
              key={issue.message}
              issue={issue}
              opacity={interpolateNumber({
                value: frame,
                inputStart: issueIndex * V2_SCAN_FRAMES_PER_ISSUE,
                inputEnd: issueIndex * V2_SCAN_FRAMES_PER_ISSUE + V2_SCAN_ROW_FADE_DURATION_FRAMES,
                outputStart: 0,
                outputEnd: 1,
              })}
            />
          ))}
        </div>
      </div>
      <div
        className="v2-scan-overlay"
        style={{
          height: V2_SCAN_OVERLAY_HEIGHT_PX,
          padding: `${V2_SCAN_OVERLAY_TOP_PADDING_PX}px ${V2_SCAN_OVERLAY_HORIZONTAL_PADDING_PX}px 0`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: V2_SCAN_TITLE_FONT_SIZE_PX,
            fontWeight: 400,
            color: WHITE_COLOR,
            opacity: titleOpacity,
            textAlign: "center",
            lineHeight: 1.4,
            textShadow:
              "0 0 40px rgba(10,10,10,0.95), 0 0 80px rgba(10,10,10,0.9), 0 0 120px rgba(10,10,10,0.8)",
          }}
        >
          Scan for React issues
        </div>
      </div>
    </div>
  );
};
