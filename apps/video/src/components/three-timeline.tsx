import { DoctorFace } from "./doctor-face";
import { ThreeClaudeCode } from "./three-claude-code";
import { ThreeCodeCard } from "./three-code-card";
import { ThreeDonutStage } from "./three-donut-stage";
import { ThreeFindingRow } from "./three-finding-row";
import { ThreePerformanceMeter } from "./three-performance-meter";
import { easeInOutCubic } from "../utils/ease-in-out-cubic";
import { easeOutCubic } from "../utils/ease-out-cubic";
import { interpolateNumber } from "../utils/interpolate-number";
import { FONT_FAMILY, GREEN_COLOR, RED_COLOR, WHITE_COLOR, YELLOW_COLOR } from "../constants";
import {
  THREE_BAD_CODE_LINES,
  THREE_CLAUDE_END_FRAME,
  THREE_FINDING_FADE_DURATION_FRAMES,
  THREE_FINDING_INTERVAL_FRAMES,
  THREE_FINDINGS,
  THREE_FIX_INTERVAL_FRAMES,
  THREE_GOOD_CODE_LINES,
  THREE_INTRO_END_FRAME,
  THREE_PROBLEM_END_FRAME,
  THREE_PROBLEM_REVEAL_FRAME,
  THREE_SCAN_END_FRAME,
  THREE_TOTAL_DURATION_FRAMES,
  THREE_TRANSITION_DURATION_FRAMES,
} from "../three-constants";

export interface ThreeTimelineProps {
  frame: number;
}

export const ThreeTimeline = ({ frame }: ThreeTimelineProps) => {
  const introProgress = interpolateNumber({
    value: frame,
    inputStart: 0,
    inputEnd: 28,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const problemProgress = interpolateNumber({
    value: frame,
    inputStart: THREE_INTRO_END_FRAME - THREE_TRANSITION_DURATION_FRAMES,
    inputEnd: THREE_INTRO_END_FRAME,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const scanProgress = interpolateNumber({
    value: frame,
    inputStart: THREE_PROBLEM_END_FRAME - THREE_TRANSITION_DURATION_FRAMES,
    inputEnd: THREE_PROBLEM_END_FRAME,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const claudeProgress = interpolateNumber({
    value: frame,
    inputStart: THREE_SCAN_END_FRAME - THREE_TRANSITION_DURATION_FRAMES,
    inputEnd: THREE_SCAN_END_FRAME,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const optimizationProgress = interpolateNumber({
    value: frame,
    inputStart: THREE_CLAUDE_END_FRAME - THREE_TRANSITION_DURATION_FRAMES,
    inputEnd: THREE_CLAUDE_END_FRAME + 34,
    outputStart: 0,
    outputEnd: 1,
    easing: easeInOutCubic,
  });
  const finalProgress = interpolateNumber({
    value: frame,
    inputStart: THREE_TOTAL_DURATION_FRAMES - 58,
    inputEnd: THREE_TOTAL_DURATION_FRAMES - 34,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const claudeExitProgress = interpolateNumber({
    value: optimizationProgress,
    inputStart: 0,
    inputEnd: 0.7,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });
  const introOpacity = 1 - problemProgress;
  const problemOpacity = problemProgress * (1 - scanProgress);
  const scanOpacity = scanProgress * (1 - claudeProgress);
  const claudeOpacity = claudeProgress * (1 - claudeExitProgress);
  const optimizedOpacity = optimizationProgress * (1 - finalProgress);
  const warningOpacity = interpolateNumber({
    value: frame,
    inputStart: THREE_PROBLEM_REVEAL_FRAME,
    inputEnd: THREE_PROBLEM_REVEAL_FRAME + 12,
    outputStart: 0,
    outputEnd: 1,
    easing: easeOutCubic,
  });

  return (
    <div className="scene three-scene" style={{ fontFamily: FONT_FAMILY }}>
      <div className="three-grid" />
      <div
        className="three-ambient-glow"
        style={{
          backgroundColor: optimizationProgress > 0.5 ? GREEN_COLOR : YELLOW_COLOR,
          opacity: 0.08 + optimizationProgress * 0.05,
        }}
      />

      <div
        className="three-donut-wrap"
        style={{
          opacity: introProgress,
          transform: `translate(${scanProgress * 240 - optimizationProgress * 240}px, ${scanProgress * -118 + optimizationProgress * 118}px) scale(${1 - scanProgress * 0.18 + optimizationProgress * 0.18})`,
        }}
      >
        <ThreeDonutStage
          frame={frame}
          optimizationProgress={optimizationProgress}
          problemProgress={problemProgress}
        />
      </div>

      <section
        className="three-copy three-intro-copy"
        style={{
          opacity: introOpacity * introProgress,
          transform: `translateY(${(1 - introProgress) * 32}px)`,
        }}
      >
        <div className="three-kicker">REACT DOCTOR&nbsp;&nbsp;×&nbsp;&nbsp;3D</div>
        <h2>Your 3D scene deserves a performance review.</h2>
        <p>THREE.JS&nbsp;&nbsp;/&nbsp;&nbsp;REACT THREE FIBER</p>
      </section>

      <section className="three-problem-layout" style={{ opacity: problemOpacity }}>
        <div className="three-copy three-problem-copy">
          <div className="three-step-label">01 / FRAME LOOP</div>
          <h2>Pretty can still be expensive.</h2>
          <ThreeCodeCard
            isOptimized={false}
            lines={THREE_BAD_CODE_LINES}
            opacity={problemOpacity}
            title="Donut.tsx"
          />
        </div>
        <div className="three-problem-hud">
          <ThreePerformanceMeter
            optimizationProgress={optimizationProgress}
            problemProgress={warningOpacity}
          />
          <div className="three-warning-pill" style={{ opacity: warningOpacity }}>
            <span style={{ color: RED_COLOR }}>!</span>
            NEW OBJECT, EVERY FRAME
          </div>
        </div>
      </section>

      <section className="three-scan-layout" style={{ opacity: scanOpacity }}>
        <div className="three-scan-heading">
          <div className="three-step-label">02 / REACT DOCTOR</div>
          <h2>It reads the scene graph.</h2>
          <p>React Three Fiber detected&nbsp;&nbsp;·&nbsp;&nbsp;performance rules enabled</p>
        </div>
        <div className="three-findings">
          {THREE_FINDINGS.map((finding, findingIndex) => (
            <ThreeFindingRow
              key={finding.title}
              finding={finding}
              fixProgress={0}
              opacity={interpolateNumber({
                value: frame,
                inputStart: THREE_PROBLEM_END_FRAME + findingIndex * THREE_FINDING_INTERVAL_FRAMES,
                inputEnd:
                  THREE_PROBLEM_END_FRAME +
                  findingIndex * THREE_FINDING_INTERVAL_FRAMES +
                  THREE_FINDING_FADE_DURATION_FRAMES,
                outputStart: 0,
                outputEnd: 1,
                easing: easeOutCubic,
              })}
            />
          ))}
        </div>
      </section>

      <section className="three-optimized-layout" style={{ opacity: optimizedOpacity }}>
        <div className="three-copy three-optimized-copy">
          <div className="three-step-label" style={{ color: GREEN_COLOR }}>
            03 / OPTIMIZED
          </div>
          <h2>Reuse. Batch. Move by delta.</h2>
          <ThreeCodeCard
            isOptimized
            lines={THREE_GOOD_CODE_LINES}
            opacity={optimizedOpacity}
            title="Donut.tsx"
          />
        </div>
        <div className="three-optimized-hud">
          <ThreePerformanceMeter
            optimizationProgress={optimizationProgress}
            problemProgress={optimizedOpacity}
          />
          <div className="three-fixed-list">
            {THREE_FINDINGS.slice(0, 3).map((finding, findingIndex) => (
              <ThreeFindingRow
                key={finding.title}
                finding={finding}
                fixProgress={interpolateNumber({
                  value: frame,
                  inputStart: THREE_CLAUDE_END_FRAME + findingIndex * THREE_FIX_INTERVAL_FRAMES,
                  inputEnd: THREE_CLAUDE_END_FRAME + findingIndex * THREE_FIX_INTERVAL_FRAMES + 6,
                  outputStart: 0,
                  outputEnd: 1,
                  easing: easeOutCubic,
                })}
                opacity={1}
              />
            ))}
          </div>
        </div>
      </section>

      {claudeOpacity > 0 && (
        <ThreeClaudeCode localFrame={frame - THREE_SCAN_END_FRAME} opacity={claudeOpacity} />
      )}

      <section
        className="three-final-layout"
        style={{ opacity: finalProgress, transform: `scale(${0.97 + finalProgress * 0.03})` }}
      >
        <DoctorFace color={GREEN_COLOR} mood="happy" size={126} />
        <div>
          <div className="three-kicker" style={{ color: GREEN_COLOR }}>
            REACT DOCTOR FOR 3D
          </div>
          <h2>Ship smoother 3D.</h2>
          <p>npx react-doctor@latest</p>
        </div>
      </section>

      <div className="three-corner-mark" style={{ color: WHITE_COLOR }}>
        RD&nbsp;&nbsp;/&nbsp;&nbsp;3D
      </div>
    </div>
  );
};
