import { GREEN_COLOR, RED_COLOR } from "../constants";
import {
  THREE_BAD_FPS,
  THREE_GRAPH_BAR_HEIGHT_PX,
  THREE_GRAPH_BAR_IDS,
  THREE_INITIAL_ALLOCATIONS_PER_SECOND,
  THREE_TARGET_FPS,
} from "../three-constants";

export interface ThreePerformanceMeterProps {
  optimizationProgress: number;
  problemProgress: number;
}

export const ThreePerformanceMeter = ({
  optimizationProgress,
  problemProgress,
}: ThreePerformanceMeterProps) => {
  const framesPerSecond = Math.round(
    THREE_BAD_FPS + (THREE_TARGET_FPS - THREE_BAD_FPS) * optimizationProgress,
  );
  const allocationsPerSecond = Math.round(
    THREE_INITIAL_ALLOCATIONS_PER_SECOND * (1 - optimizationProgress),
  );
  const meterColor = optimizationProgress > 0.5 ? GREEN_COLOR : RED_COLOR;
  const bars = THREE_GRAPH_BAR_IDS.map((id, barIndex) => {
    const wave = (Math.sin(barIndex * 1.7) + 1) / 2;
    const unstableHeight = 0.3 + wave * 0.7;
    const stableHeight = 0.84 + wave * 0.08;
    return { height: unstableHeight + (stableHeight - unstableHeight) * optimizationProgress, id };
  });

  return (
    <div className="three-performance-meter" style={{ opacity: problemProgress }}>
      <div className="three-meter-heading">
        <span>FRAME HEALTH</span>
        <span style={{ color: meterColor }}>{framesPerSecond} FPS</span>
      </div>
      <div className="three-meter-graph">
        {bars.map((bar) => (
          <span
            key={bar.id}
            style={{
              backgroundColor: meterColor,
              height: bar.height * THREE_GRAPH_BAR_HEIGHT_PX,
              opacity: 0.35 + bar.height * 0.65,
            }}
          />
        ))}
      </div>
      <div className="three-meter-stats">
        <span>{allocationsPerSecond} frame allocations / sec</span>
        <span>{optimizationProgress > 0.5 ? "DPR ≤ 1.5" : "DPR = device"}</span>
      </div>
    </div>
  );
};
