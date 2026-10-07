import {
  SCORE_HEADER_ANIMATION_FRAME_COUNT,
  SCORE_HEADER_ANIMATION_FRAME_DELAY_MS,
  SCORE_PROJECTION_FRAME_COUNT,
  SCORE_PROJECTION_FRAME_DELAY_MS,
} from "../../utils/constants.js";
import { easeOutCubic } from "../../utils/ease-out-cubic.js";
import { useEffect, useState } from "../react-runtime.js";

export interface UseAnimatedScoreOptions {
  readonly score: number;
  readonly projectedScore: number | null;
  readonly shouldAnimate: boolean;
}

export interface AnimatedScore {
  readonly displayScore: number;
  readonly displayProjectedScore: number | null;
}

export const useAnimatedScore = ({
  score,
  projectedScore,
  shouldAnimate,
}: UseAnimatedScoreOptions): AnimatedScore => {
  const projectionTarget = projectedScore ?? score;
  const hasProjection = projectionTarget > score;
  const initialProjectedScore = !shouldAnimate && hasProjection ? projectionTarget : null;
  const [displayScore, setDisplayScore] = useState(shouldAnimate ? 0 : score);
  const [displayProjectedScore, setDisplayProjectedScore] = useState<number | null>(
    initialProjectedScore,
  );

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayScore(score);
      setDisplayProjectedScore(hasProjection ? projectionTarget : null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const runProjection = (): void => {
      let projectionFrame = 1;
      const renderProjectionFrame = (): void => {
        const progress = easeOutCubic(projectionFrame / SCORE_PROJECTION_FRAME_COUNT);
        setDisplayProjectedScore(score + (projectionTarget - score) * progress);
        if (projectionFrame < SCORE_PROJECTION_FRAME_COUNT) {
          projectionFrame += 1;
          timeoutId = setTimeout(renderProjectionFrame, SCORE_PROJECTION_FRAME_DELAY_MS);
        } else {
          setDisplayProjectedScore(projectionTarget);
        }
      };
      renderProjectionFrame();
    };

    let scoreFrame = 0;
    const renderScoreFrame = (): void => {
      const progress = easeOutCubic(scoreFrame / SCORE_HEADER_ANIMATION_FRAME_COUNT);
      setDisplayScore(Math.round(score * progress));
      if (scoreFrame < SCORE_HEADER_ANIMATION_FRAME_COUNT) {
        scoreFrame += 1;
        timeoutId = setTimeout(renderScoreFrame, SCORE_HEADER_ANIMATION_FRAME_DELAY_MS);
        return;
      }
      setDisplayScore(score);
      if (hasProjection) runProjection();
    };
    renderScoreFrame();

    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [shouldAnimate, score, projectionTarget, hasProjection]);

  return { displayScore, displayProjectedScore };
};
