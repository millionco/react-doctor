import { m } from "framer-motion";
import { easeInOutCubic } from "../utils/ease-in-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import {
  V2_CROSSFADE_IN_START_PROGRESS,
  V2_CROSSFADE_OUT_END_PROGRESS,
  V2_DIAGNOSE_START_FRAME,
  V2_FINAL_TRANSITION_FRAMES,
  V2_FILE_SCAN_DURATION_FRAMES,
  V2_FILE_SCAN_START_FRAME,
  V2_HERO_SCORE,
  V2_SCORE_START_FRAME,
  V2_TRANSITION_DURATION_FRAMES,
  V2_TYPING_DURATION_FRAMES,
} from "../v2-constants";
import { ScoreReveal } from "../scenes/score-reveal";
import { V2DiagnoseAndFix } from "../scenes/v2-diagnose-and-fix";
import { V2FileScan } from "../scenes/v2-file-scan";
import { V2TerminalTyping } from "../scenes/v2-terminal-typing";
import { VIDEO_HEIGHT_PX } from "../constants";

export interface V2TimelineProps {
  frame: number;
}

export const V2Timeline = ({ frame }: V2TimelineProps) => {
  const slideProgress = interpolateNumber({
    value: frame,
    inputStart: V2_FILE_SCAN_START_FRAME,
    inputEnd: V2_TYPING_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const fadeProgress = interpolateNumber({
    value: frame,
    inputStart: V2_DIAGNOSE_START_FRAME,
    inputEnd: V2_DIAGNOSE_START_FRAME + V2_TRANSITION_DURATION_FRAMES,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const fileScanLocalFrame = frame - V2_FILE_SCAN_START_FRAME;
  const diagnoseLocalFrame = frame - V2_DIAGNOSE_START_FRAME;
  const fileScanOpacity =
    1 -
    interpolateNumber({
      value: fadeProgress,
      inputStart: 0,
      inputEnd: V2_CROSSFADE_OUT_END_PROGRESS,
      outputStart: 0,
      outputEnd: 1,
    });
  const diagnoseOpacity = interpolateNumber({
    value: fadeProgress,
    inputStart: V2_CROSSFADE_IN_START_PROGRESS,
    inputEnd: 1,
    outputStart: 0,
    outputEnd: 1,
  });
  const finalTransitionStartFrame = V2_SCORE_START_FRAME - V2_FINAL_TRANSITION_FRAMES;
  const finalTransitionProgress = interpolateNumber({
    value: frame,
    inputStart: finalTransitionStartFrame,
    inputEnd: V2_SCORE_START_FRAME,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  return (
    <>
      {frame < V2_TYPING_DURATION_FRAMES && (
        <m.div
          key="terminal"
          className="scene"
          style={{ transform: `translateY(-${slideProgress * VIDEO_HEIGHT_PX}px)` }}
        >
          <V2TerminalTyping frame={frame} />
        </m.div>
      )}
      {frame >= V2_FILE_SCAN_START_FRAME && fileScanLocalFrame < V2_FILE_SCAN_DURATION_FRAMES && (
        <m.div
          key="file-scan"
          className="scene"
          style={{
            opacity: frame >= V2_DIAGNOSE_START_FRAME ? fileScanOpacity : 1,
            transform:
              frame < V2_TYPING_DURATION_FRAMES
                ? `translateY(${(1 - slideProgress) * VIDEO_HEIGHT_PX}px)`
                : "translateY(0)",
          }}
        >
          <V2FileScan frame={fileScanLocalFrame} />
        </m.div>
      )}
      {frame >= V2_DIAGNOSE_START_FRAME && frame < V2_SCORE_START_FRAME && (
        <m.div
          key="diagnose"
          className="scene"
          style={{
            opacity:
              frame >= finalTransitionStartFrame ? 1 - finalTransitionProgress : diagnoseOpacity,
          }}
        >
          <V2DiagnoseAndFix frame={diagnoseLocalFrame} />
        </m.div>
      )}
      {frame >= finalTransitionStartFrame && (
        <m.div
          key="score"
          className="scene"
          style={{
            opacity: finalTransitionProgress,
            transform: `translateY(${(1 - finalTransitionProgress) * 24}px) scale(${
              0.98 + finalTransitionProgress * 0.02
            })`,
          }}
        >
          <ScoreReveal frame={frame - V2_SCORE_START_FRAME} startingScore={V2_HERO_SCORE} />
        </m.div>
      )}
    </>
  );
};
