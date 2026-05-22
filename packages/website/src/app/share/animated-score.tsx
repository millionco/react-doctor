"use client";

import { useEffect, useState } from "react";
import { PERFECT_SCORE } from "@/constants";
import { getScoreColorClass } from "@/utils/get-score-color-class";
import { getScoreLabel } from "@/utils/get-score-label";

const SCORE_BAR_WIDTH = 30;
const SCORE_FRAME_COUNT = 20;
const SCORE_FRAME_DELAY_MS = 30;

const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

const ScoreBar = ({ score }: { score: number }) => {
  const filledCount = Math.round((score / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const emptyCount = SCORE_BAR_WIDTH - filledCount;
  const colorClass = getScoreColorClass(score);

  return (
    <>
      <span className={colorClass}>{"\u2588".repeat(filledCount)}</span>
      <span className="text-neutral-600">{"\u2591".repeat(emptyCount)}</span>
    </>
  );
};

const AnimatedScore = ({ targetScore }: { targetScore: number }) => {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    let frame = 0;
    let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const animate = () => {
      if (isCancelled || frame > SCORE_FRAME_COUNT) return;
      setAnimatedScore(Math.round(easeOutCubic(frame / SCORE_FRAME_COUNT) * targetScore));
      frame++;
      pendingTimeoutId = setTimeout(animate, SCORE_FRAME_DELAY_MS);
    };

    animate();
    return () => {
      isCancelled = true;
      if (pendingTimeoutId !== null) clearTimeout(pendingTimeoutId);
    };
  }, [targetScore]);

  const colorClass = getScoreColorClass(animatedScore);

  return (
    <>
      <div className="mb-2 pl-2">
        <span className={colorClass}>{animatedScore}</span>
        {` / ${PERFECT_SCORE}  `}
        <span className={colorClass}>{getScoreLabel(animatedScore)}</span>
      </div>
      <div className="mb-6 pl-2">
        <ScoreBar score={animatedScore} />
      </div>
    </>
  );
};

export default AnimatedScore;
