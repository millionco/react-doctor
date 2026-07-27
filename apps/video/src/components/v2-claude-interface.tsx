import {
  DIVIDER_COLOR,
  FONT_FAMILY,
  GREEN_COLOR,
  MUTED_COLOR,
  TEXT_COLOR,
  WHITE_COLOR,
} from "../constants";
import { V2DiagnosticList } from "./v2-diagnostic-list";
import {
  V2_CLAUDE_COLOR,
  V2_CLAUDE_DONE_FADE_DURATION_FRAMES,
  V2_CLAUDE_HEADER_FADE_DURATION_FRAMES,
  V2_CLAUDE_HEADER_FADE_START_FRAME,
  V2_CLAUDE_HEADER_GAP_PX,
  V2_CLAUDE_HEADER_RESTING_OPACITY,
  V2_CLAUDE_HEADER_SLIDE_PX,
  V2_CLAUDE_HORIZONTAL_PADDING_PX,
  V2_CLAUDE_ITEMS_START_FRAME,
  V2_CLAUDE_LOGO_SIZE_PX,
  V2_CLAUDE_META_FONT_SIZE_PX,
  V2_CLAUDE_PROMPT_FONT_SIZE_PX,
  V2_CLAUDE_PROMPT_TOP_PX,
  V2_CLAUDE_SPINNER_START_FRAME,
  V2_CLAUDE_STATUS_FONT_SIZE_PX,
  V2_CLAUDE_STATUS_TOP_PX,
  V2_CLAUDE_TITLE_FONT_SIZE_PX,
  V2_CLAUDE_TOP_PADDING_PX,
  V2_DIAGNOSTICS,
} from "../v2-constants";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";

export interface V2ClaudeInterfaceProps {
  allFixed: boolean;
  allFixedFrame: number;
  fixedDiagnosticCount: number;
  frame: number;
  isFixing: boolean;
  spinnerCharacter: string;
}

export const V2ClaudeInterface = ({
  allFixed,
  allFixedFrame,
  fixedDiagnosticCount,
  frame,
  isFixing,
  spinnerCharacter,
}: V2ClaudeInterfaceProps) => {
  const headerOpacity = interpolateNumber({
    value: frame,
    inputStart: V2_CLAUDE_HEADER_FADE_START_FRAME,
    inputEnd: V2_CLAUDE_HEADER_FADE_START_FRAME + V2_CLAUDE_HEADER_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const headerTranslateY = interpolateNumber({
    value: frame,
    inputStart: V2_CLAUDE_HEADER_FADE_START_FRAME,
    inputEnd: V2_CLAUDE_HEADER_FADE_START_FRAME + V2_CLAUDE_HEADER_FADE_DURATION_FRAMES,
    outputStart: -V2_CLAUDE_HEADER_SLIDE_PX,
    outputEnd: 0,
    easing: easeOutCubic,
  });
  const doneOpacity = interpolateNumber({
    value: frame,
    inputStart: allFixedFrame,
    inputEnd: allFixedFrame + V2_CLAUDE_DONE_FADE_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: V2_CLAUDE_TOP_PADDING_PX,
          left: V2_CLAUDE_HORIZONTAL_PADDING_PX,
          opacity:
            headerOpacity *
            interpolateNumber({
              value: frame,
              inputStart: V2_CLAUDE_ITEMS_START_FRAME - 10,
              inputEnd: V2_CLAUDE_ITEMS_START_FRAME,
              outputStart: 1,
              outputEnd: V2_CLAUDE_HEADER_RESTING_OPACITY,
            }),
          transform: `translateY(${headerTranslateY}px)`,
          display: "flex",
          alignItems: "center",
          gap: V2_CLAUDE_HEADER_GAP_PX,
        }}
      >
        <img
          alt=""
          src="/claudecode-color.svg"
          style={{
            width: V2_CLAUDE_LOGO_SIZE_PX,
            height: V2_CLAUDE_LOGO_SIZE_PX,
            flexShrink: 0,
          }}
        />
        <div style={{ fontFamily: FONT_FAMILY }}>
          <div
            style={{
              color: WHITE_COLOR,
              fontSize: V2_CLAUDE_TITLE_FONT_SIZE_PX,
              lineHeight: 1.15,
              fontWeight: 500,
            }}
          >
            Claude Code
          </div>
          <div
            style={{
              color: MUTED_COLOR,
              fontSize: V2_CLAUDE_META_FONT_SIZE_PX,
              lineHeight: 1.5,
              marginTop: 8,
            }}
          >
            Opus 5 · Claude API
          </div>
          <div
            style={{
              color: MUTED_COLOR,
              fontSize: V2_CLAUDE_META_FONT_SIZE_PX,
              lineHeight: 1.5,
            }}
          >
            ~/Developer/my-app
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: V2_CLAUDE_PROMPT_TOP_PX,
          left: V2_CLAUDE_HORIZONTAL_PADDING_PX,
          right: V2_CLAUDE_HORIZONTAL_PADDING_PX,
          fontFamily: FONT_FAMILY,
          fontSize: V2_CLAUDE_PROMPT_FONT_SIZE_PX,
          color: TEXT_COLOR,
          opacity: headerOpacity,
          borderTop: `1px solid ${DIVIDER_COLOR}`,
          borderBottom: `1px solid ${DIVIDER_COLOR}`,
          padding: "8px 0",
        }}
      >
        <span style={{ color: MUTED_COLOR }}>❯ </span>
        <span style={{ color: WHITE_COLOR }}>fix my React code</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: V2_CLAUDE_STATUS_TOP_PX,
          left: V2_CLAUDE_HORIZONTAL_PADDING_PX,
          fontFamily: FONT_FAMILY,
          fontSize: V2_CLAUDE_STATUS_FONT_SIZE_PX,
        }}
      >
        {frame >= V2_CLAUDE_SPINNER_START_FRAME && !allFixed && (
          <span style={{ color: V2_CLAUDE_COLOR }}>{spinnerCharacter} Fixing issues…</span>
        )}
        {allFixed && (
          <span style={{ color: GREEN_COLOR, opacity: doneOpacity }}>
            ✓ All {V2_DIAGNOSTICS.length} issues fixed
          </span>
        )}
      </div>
      <V2DiagnosticList
        fixedDiagnosticCount={fixedDiagnosticCount}
        frame={frame}
        isFixing={isFixing}
      />
    </>
  );
};
