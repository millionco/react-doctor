import { useEffect, useState } from "react";
import {
  SCORE_HEADER_ANIMATION_FRAME_COUNT,
  SCORE_HEADER_ANIMATION_FRAME_DELAY_MS,
  SCORE_PROJECTION_FRAME_COUNT,
  SCORE_PROJECTION_FRAME_DELAY_MS,
} from "../../utils/constants.js";
import { easeOutCubic } from "../../utils/ease-out-cubic.js";

export interface UseAnimatedScoreOptions {
  readonly score: number;
  readonly projectedScore: number | null;
  readonly animate: boolean;
}

export interface AnimatedScore {
  readonly displayScore: number;
  readonly displayProjectedScore: number | null;
}

export const useAnimatedScore = ({
  score,
  projectedScore,
  animate,
}: UseAnimatedScoreOptions): AnimatedScore => {
  const projectionTarget = projectedScore ?? score;
  const hasProjection = projectionTarget > score;
  const [displayScore, setDisplayScore] = useState(animate ? 0 : score);
  const [displayProjectedScore, setDisplayProjectedScore] = useState<number | null>(
    animate ? null : hasProjection ? projectionTarget : null,
  );

  useEffect(() => {
    if (!animate) {
      setDisplayScore(score);
      setDisplayProjectedScore(hasProjection ? projectionTarget : null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    const runProjection = (): void => {
      let frame = 1;
      const tick = (): void => {
        const progress = easeOutCubic(frame / SCORE_PROJECTION_FRAME_COUNT);
        setDisplayProjectedScore(score + (projectionTarget - score) * progress);
        if (frame < SCORE_PROJECTION_FRAME_COUNT) {
          frame += 1;
          timeoutId = setTimeout(tick, SCORE_PROJECTION_FRAME_DELAY_MS);
        } else {
          setDisplayProjectedScore(projectionTarget);
        }
      };
      tick();
    };

    let frame = 0;
    const tick = (): void => {
      const progress = easeOutCubic(frame / SCORE_HEADER_ANIMATION_FRAME_COUNT);
      setDisplayScore(Math.round(score * progress));
      if (frame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
        frame += 1;
        timeoutId = setTimeout(tick, SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
        return;
      }
      setDisplayScore(score);
      if (hasProjection) runProjection();
    };
    tick();

    return () => clearTimeout(timeoutId);
  }, [animate, score, projectionTarget, hasProjection]);

  return { displayScore, displayProjectedScore };
};
