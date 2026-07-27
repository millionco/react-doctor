import {
  BACKGROUND_COLOR,
  ERROR_BADGE_BACKGROUND_COLOR,
  ERROR_BADGE_TEXT_COLOR,
  FONT_FAMILY,
  GREEN_COLOR,
  MUTED_COLOR,
  TEXT_COLOR,
  WARNING_BADGE_BACKGROUND_COLOR,
} from "../constants";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX,
  V2_CLAUDE_FIX_FADE_DURATION_FRAMES,
  V2_CLAUDE_FIX_INTERVAL_FRAMES,
  V2_CLAUDE_FIX_START_FRAME,
  V2_CLAUDE_ITEMS_START_FRAME,
  V2_CLAUDE_ITEMS_TOP_PX,
  V2_CLAUDE_LIST_FADE_HEIGHT_PX,
  V2_CLAUDE_LIST_HEIGHT_PX,
  V2_CLAUDE_HORIZONTAL_PADDING_PX,
  V2_DIAGNOSTICS,
  V2_SCAN_BADGE_RADIUS_PX,
} from "../v2-constants";

export interface V2DiagnosticListProps {
  fixedDiagnosticCount: number;
  frame: number;
  isFixing: boolean;
}

const diagnosticRowHeightPixels = V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX * 1.7;
const maximumScrollPixels = Math.max(
  0,
  V2_DIAGNOSTICS.length * diagnosticRowHeightPixels - V2_CLAUDE_LIST_HEIGHT_PX,
);

export const V2DiagnosticList = ({
  fixedDiagnosticCount,
  frame,
  isFixing,
}: V2DiagnosticListProps) => {
  const listOpacity = interpolateNumber({
    value: frame,
    inputStart: V2_CLAUDE_ITEMS_START_FRAME,
    inputEnd: V2_CLAUDE_ITEMS_START_FRAME + 10,
    outputStart: 0,
    outputEnd: 1,
  });
  const scrollY = interpolateNumber({
    value: frame,
    inputStart: V2_CLAUDE_ITEMS_START_FRAME,
    inputEnd: V2_CLAUDE_FIX_START_FRAME + V2_DIAGNOSTICS.length * V2_CLAUDE_FIX_INTERVAL_FRAMES,
    outputStart: 0,
    outputEnd: maximumScrollPixels,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: V2_CLAUDE_ITEMS_TOP_PX,
        left: V2_CLAUDE_HORIZONTAL_PADDING_PX,
        right: V2_CLAUDE_HORIZONTAL_PADDING_PX,
        height: V2_CLAUDE_LIST_HEIGHT_PX,
        overflow: "hidden",
        zIndex: 10,
        opacity: listOpacity,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 0 auto",
          height: V2_CLAUDE_LIST_FADE_HEIGHT_PX,
          background: `linear-gradient(to bottom, ${BACKGROUND_COLOR}, transparent)`,
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "auto 0 0",
          height: V2_CLAUDE_LIST_FADE_HEIGHT_PX,
          background: `linear-gradient(to top, ${BACKGROUND_COLOR}, transparent)`,
          zIndex: 2,
        }}
      />
      <div style={{ transform: `translateY(-${scrollY}px)`, padding: "12px 0" }}>
        {V2_DIAGNOSTICS.map((diagnostic, diagnosticIndex) => {
          const fixProgress = interpolateNumber({
            value:
              frame - (V2_CLAUDE_FIX_START_FRAME + diagnosticIndex * V2_CLAUDE_FIX_INTERVAL_FRAMES),
            inputStart: 0,
            inputEnd: V2_CLAUDE_FIX_FADE_DURATION_FRAMES,
            outputStart: 0,
            outputEnd: 1,
            easing: easeOutCubic,
          });
          const isFixed = isFixing && diagnosticIndex < fixedDiagnosticCount && fixProgress > 0.3;
          const isError = diagnostic.severity === "error";

          return (
            <div
              key={diagnostic.message}
              style={{
                fontFamily: FONT_FAMILY,
                fontSize: V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX,
                lineHeight: 1.7,
                color: isFixed ? MUTED_COLOR : TEXT_COLOR,
                textDecoration: isFixed ? "line-through" : "none",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                className="v2-diagnostic-badge"
                style={{
                  borderRadius: V2_SCAN_BADGE_RADIUS_PX,
                  backgroundColor: isFixed
                    ? "transparent"
                    : isError
                      ? ERROR_BADGE_BACKGROUND_COLOR
                      : WARNING_BADGE_BACKGROUND_COLOR,
                  color: isFixed ? GREEN_COLOR : ERROR_BADGE_TEXT_COLOR,
                  fontSize: V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX * 0.7,
                }}
              >
                {isFixed ? "✓" : "!"}
              </span>
              <span style={{ flex: 1 }}>{diagnostic.message}</span>
              <span
                style={{
                  color: MUTED_COLOR,
                  flexShrink: 0,
                  fontSize: V2_CLAUDE_DIAGNOSTIC_FONT_SIZE_PX * 0.8,
                }}
              >
                {diagnostic.file}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
