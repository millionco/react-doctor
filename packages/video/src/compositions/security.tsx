import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import {
  SCENE_SCORE_REVEAL_DURATION_FRAMES,
  SECURITY_FIX_DURATION_FRAMES,
  SECURITY_INTRO_DURATION_FRAMES,
  SECURITY_SCAN_DURATION_FRAMES,
  TRANSITION_DURATION_FRAMES,
} from "../constants";
import { securityContent } from "../content/security";
import { DiagnoseAndFix } from "../scenes/diagnose-and-fix";
import { ScoreReveal } from "../scenes/score-reveal";
import { SecurityIntro } from "../scenes/security-intro";
import { SecurityScan } from "../scenes/security-scan";
import { waitUntilDone } from "../utils/font";

export const Security = () => {
  const [handle] = useState(() => delayRender("Loading font"));

  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={SECURITY_INTRO_DURATION_FRAMES}>
        <SecurityIntro />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={springTiming({
          config: { damping: 200 },
          durationInFrames: TRANSITION_DURATION_FRAMES,
        })}
      />

      <TransitionSeries.Sequence durationInFrames={SECURITY_SCAN_DURATION_FRAMES}>
        <SecurityScan content={securityContent} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={springTiming({
          config: { damping: 200 },
          durationInFrames: TRANSITION_DURATION_FRAMES,
        })}
      />

      <TransitionSeries.Sequence durationInFrames={SECURITY_FIX_DURATION_FRAMES}>
        <DiagnoseAndFix content={securityContent} showScore={false} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence durationInFrames={SCENE_SCORE_REVEAL_DURATION_FRAMES}>
        <ScoreReveal />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
