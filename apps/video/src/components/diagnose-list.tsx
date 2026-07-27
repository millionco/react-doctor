import {
  BACKGROUND_COLOR,
  DIAGNOSE_FIXED_STYLE_PROGRESS,
  DIAGNOSE_FIX_FADE_DURATION_FRAMES,
  DIAGNOSE_FIX_INTERVAL_FRAMES,
  DIAGNOSE_HORIZONTAL_PADDING_PX,
  DIAGNOSE_ITEM_FONT_SIZE_PX,
  DIAGNOSE_ITEMS_TOP_PX,
  DIAGNOSE_LIST_FADE_HEIGHT_PX,
  DIAGNOSE_LIST_VERTICAL_PADDING_PX,
  DIAGNOSTICS,
} from "../constants";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import { IssueRow } from "./issue-row";

export interface DiagnoseListProps {
  fixedIssueCount: number;
  fixStartFrame: number;
  frame: number;
  grayscale: number;
  height: number;
  isFixing: boolean;
  opacity: number;
  scrollY: number;
}

export const DiagnoseList = ({
  fixedIssueCount,
  fixStartFrame,
  frame,
  grayscale,
  height,
  isFixing,
  opacity,
  scrollY,
}: DiagnoseListProps) => {
  if (opacity <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: DIAGNOSE_ITEMS_TOP_PX,
        left: DIAGNOSE_HORIZONTAL_PADDING_PX,
        right: DIAGNOSE_HORIZONTAL_PADDING_PX,
        height,
        overflow: "hidden",
        opacity,
        filter: `grayscale(${grayscale})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 0 auto",
          height: DIAGNOSE_LIST_FADE_HEIGHT_PX,
          background: `linear-gradient(to bottom, ${BACKGROUND_COLOR}, transparent)`,
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "auto 0 0",
          height: DIAGNOSE_LIST_FADE_HEIGHT_PX,
          background: `linear-gradient(to top, ${BACKGROUND_COLOR}, transparent)`,
          zIndex: 2,
        }}
      />
      <div
        style={{
          transform: `translateY(-${scrollY}px)`,
          padding: `${DIAGNOSE_LIST_VERTICAL_PADDING_PX}px 0`,
        }}
      >
        {DIAGNOSTICS.map((issue, issueIndex) => {
          const itemFixProgress = interpolateNumber({
            value: frame - (fixStartFrame + issueIndex * DIAGNOSE_FIX_INTERVAL_FRAMES),
            inputStart: 0,
            inputEnd: DIAGNOSE_FIX_FADE_DURATION_FRAMES,
            outputStart: 0,
            outputEnd: 1,
            easing: easeOutCubic,
          });
          const isFixed =
            isFixing &&
            issueIndex < fixedIssueCount &&
            itemFixProgress > DIAGNOSE_FIXED_STYLE_PROGRESS;
          return (
            <IssueRow
              key={issue.message}
              fontSize={DIAGNOSE_ITEM_FONT_SIZE_PX}
              isFixed={isFixed}
              issue={issue}
            />
          );
        })}
      </div>
    </div>
  );
};
