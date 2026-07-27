import {
  DIAGNOSE_HORIZONTAL_PADDING_PX,
  DIAGNOSE_LOGO_FONT_SIZE_PX,
  DIAGNOSE_LOGO_SIZE_PX,
  DIAGNOSE_PROMPT_TOP_PX,
  DIAGNOSE_TOP_PADDING_PX,
  DIVIDER_COLOR,
  FONT_FAMILY,
  MUTED_COLOR,
  TEXT_COLOR,
  WHITE_COLOR,
  YELLOW_COLOR,
} from "../constants";

export interface DiagnoseHeaderProps {
  cursorOpacity: number;
  frame: number;
  promptFontSize: number;
  remainingText: string;
  slashCommandText: string;
  zoomOutEndFrame: number;
}

export const DiagnoseHeader = ({
  cursorOpacity,
  frame,
  promptFontSize,
  remainingText,
  slashCommandText,
  zoomOutEndFrame,
}: DiagnoseHeaderProps) => (
  <>
    <div
      style={{
        position: "absolute",
        top: DIAGNOSE_TOP_PADDING_PX,
        left: DIAGNOSE_HORIZONTAL_PADDING_PX,
        fontFamily: FONT_FAMILY,
        fontSize: DIAGNOSE_LOGO_FONT_SIZE_PX,
        lineHeight: 1.6,
        display: "flex",
        alignItems: "center",
        gap: 32,
      }}
    >
      <img
        alt=""
        src="/claudecode-color.svg"
        style={{ width: DIAGNOSE_LOGO_SIZE_PX, height: DIAGNOSE_LOGO_SIZE_PX }}
      />
      <div>
        <div style={{ color: WHITE_COLOR, fontWeight: 500 }}>Claude Code</div>
        <div style={{ color: MUTED_COLOR }}>/Developer/react-project</div>
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        top: DIAGNOSE_PROMPT_TOP_PX,
        left: DIAGNOSE_HORIZONTAL_PADDING_PX,
        right: DIAGNOSE_HORIZONTAL_PADDING_PX,
        fontFamily: FONT_FAMILY,
        fontSize: promptFontSize,
        color: TEXT_COLOR,
        borderTop: `1px solid ${DIVIDER_COLOR}`,
        borderBottom: `1px solid ${DIVIDER_COLOR}`,
        padding: "8px 0",
      }}
    >
      <span style={{ color: MUTED_COLOR }}>❯ </span>
      <span style={{ color: YELLOW_COLOR }}>{slashCommandText}</span>
      <span style={{ color: WHITE_COLOR }}>{remainingText}</span>
      <span style={{ opacity: frame < zoomOutEndFrame ? cursorOpacity : 0 }}>▋</span>
    </div>
  </>
);
