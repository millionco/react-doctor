import {
  CLAUDE_COLOR,
  DIAGNOSE_HORIZONTAL_PADDING_PX,
  DIAGNOSE_STATUS_FONT_SIZE_PX,
  DIAGNOSE_STATUS_TOP_PX,
  DIAGNOSE_VERDICT_FONT_SIZE_PX,
  FONT_FAMILY,
  GREEN_COLOR,
  RED_COLOR,
} from "../constants";

export interface DiagnoseStatusProps {
  allFixed: boolean;
  doneOpacity: number;
  isFixing: boolean;
  isScanning: boolean;
  isVerdictVisible: boolean;
  issueCount: number;
  listOpacity: number;
  spinnerCharacter: string;
  verdictOpacity: number;
}

export const DiagnoseStatus = ({
  allFixed,
  doneOpacity,
  isFixing,
  isScanning,
  isVerdictVisible,
  issueCount,
  listOpacity,
  spinnerCharacter,
  verdictOpacity,
}: DiagnoseStatusProps) => (
  <div
    style={{
      position: "absolute",
      top: DIAGNOSE_STATUS_TOP_PX,
      left: DIAGNOSE_HORIZONTAL_PADDING_PX,
      fontFamily: FONT_FAMILY,
      fontSize: DIAGNOSE_STATUS_FONT_SIZE_PX,
    }}
  >
    {isScanning && (
      <span style={{ color: CLAUDE_COLOR, opacity: listOpacity }}>
        {spinnerCharacter} Scanning for issues…
      </span>
    )}
    {isVerdictVisible && (
      <span
        style={{
          color: RED_COLOR,
          opacity: verdictOpacity,
          fontSize: DIAGNOSE_VERDICT_FONT_SIZE_PX,
          fontWeight: 700,
        }}
      >
        ✕ {issueCount} issues detected
      </span>
    )}
    {isFixing && !allFixed && (
      <span style={{ color: CLAUDE_COLOR }}>{spinnerCharacter} Fixing issues…</span>
    )}
    {allFixed && (
      <span
        style={{
          color: GREEN_COLOR,
          opacity: doneOpacity,
          fontSize: DIAGNOSE_VERDICT_FONT_SIZE_PX,
          fontWeight: 700,
        }}
      >
        ✓ All {issueCount} issues fixed
      </span>
    )}
  </div>
);
