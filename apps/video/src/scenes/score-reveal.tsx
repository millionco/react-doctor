import { DoctorFace } from "../components/doctor-face";
import {
  BACKGROUND_COLOR,
  CONFETTI_COLORS,
  CONFETTI_COUNT,
  CONFETTI_WAVE_COUNT,
  CONFETTI_WAVE_DELAY_FRAMES,
  EMPTY_BAR_COLOR,
  FINAL_SCORE_ANIMATION_DURATION_FRAMES,
  FINAL_SCORE_BAR_HEIGHT_PX,
  FINAL_SCORE_BAR_WIDTH_PX,
  FINAL_SCORE_FACE_SIZE_PX,
  FINAL_SCORE_FONT_SIZE_PX,
  FINAL_SCORE_GAP_PX,
  FINAL_SCORE_LABEL_FONT_SIZE_PX,
  FINAL_SCORE_URL_FONT_SIZE_PX,
  FONT_FAMILY,
  MUTED_COLOR,
  PERFECT_SCORE,
  REACT_DOCTOR_URL,
  VIDEO_WIDTH_PX,
} from "../constants";
import { getDoctorMood } from "../utils/get-doctor-mood";
import { getScoreColor } from "../utils/get-score-color";
import { getScoreLabel } from "../utils/get-score-label";
import { getSeededRandom } from "../utils/get-seeded-random";
import { interpolateNumber } from "../utils/interpolate-number";

export interface ScoreRevealProps {
  frame: number;
  startingScore?: number;
}

interface ConfettiParticle {
  aspectRatio: number;
  color: string;
  delay: number;
  gravity: number;
  id: string;
  rotation: number;
  rotationSpeed: number;
  size: number;
  startX: number;
  startY: number;
  velocityX: number;
  velocityY: number;
  wave: number;
}

const confettiParticles: ConfettiParticle[] = Array.from(
  { length: CONFETTI_COUNT },
  (_, particleIndex) => {
    const id = `confetti-${particleIndex}`;
    const angle = getSeededRandom(`angle-${particleIndex}`) * Math.PI * 0.8 + Math.PI * 0.1;
    const velocity = 12 + getSeededRandom(`velocity-${particleIndex}`) * 28;
    return {
      id,
      startX: getSeededRandom(`start-x-${particleIndex}`) * VIDEO_WIDTH_PX,
      startY: -20 + getSeededRandom(`start-y-${particleIndex}`) * 40,
      velocityX: (getSeededRandom(`velocity-x-${particleIndex}`) - 0.5) * 16,
      velocityY: Math.sin(angle) * velocity,
      gravity: 0.6 + getSeededRandom(`gravity-${particleIndex}`) * 0.4,
      wave: Math.floor(getSeededRandom(`wave-${particleIndex}`) * CONFETTI_WAVE_COUNT),
      delay: getSeededRandom(`delay-${particleIndex}`) * 3,
      size: 8 + getSeededRandom(`size-${particleIndex}`) * 16,
      color:
        CONFETTI_COLORS[
          Math.floor(getSeededRandom(`color-${particleIndex}`) * CONFETTI_COLORS.length)
        ],
      rotation: getSeededRandom(`rotation-${particleIndex}`) * 360,
      rotationSpeed: (getSeededRandom(`rotation-speed-${particleIndex}`) - 0.5) * 20,
      aspectRatio: 0.3 + getSeededRandom(`aspect-${particleIndex}`) * 0.7,
    };
  },
);

export const ScoreReveal = ({ frame, startingScore = 0 }: ScoreRevealProps) => {
  const currentScore = Math.round(
    interpolateNumber({
      value: frame,
      inputStart: 0,
      inputEnd: FINAL_SCORE_ANIMATION_DURATION_FRAMES,
      outputStart: startingScore,
      outputEnd: PERFECT_SCORE,
    }),
  );
  const scoreColor = getScoreColor(currentScore);
  const confettiProgress = Math.max(0, frame - FINAL_SCORE_ANIMATION_DURATION_FRAMES);

  return (
    <div
      className="scene"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: BACKGROUND_COLOR,
      }}
    >
      {confettiProgress > 0 &&
        confettiParticles.map((particle) => {
          const waveOffset = particle.wave * CONFETTI_WAVE_DELAY_FRAMES;
          const localProgress = Math.max(0, confettiProgress - particle.delay - waveOffset);
          const positionX = particle.startX + particle.velocityX * localProgress;
          const positionY =
            particle.startY +
            particle.velocityY * localProgress +
            0.5 * particle.gravity * localProgress * localProgress;
          let opacity = 1;
          if (localProgress < 2) {
            opacity = interpolateNumber({
              value: localProgress,
              inputStart: 0,
              inputEnd: 2,
              outputStart: 0,
              outputEnd: 1,
            });
          } else if (localProgress > 30) {
            opacity = interpolateNumber({
              value: localProgress,
              inputStart: 30,
              inputEnd: 50,
              outputStart: 1,
              outputEnd: 0,
            });
          }

          return (
            <div
              key={particle.id}
              style={{
                position: "absolute",
                left: positionX,
                top: positionY,
                width: particle.size,
                height: particle.size * particle.aspectRatio,
                backgroundColor: particle.color,
                opacity,
                transform: `rotate(${particle.rotation + localProgress * particle.rotationSpeed}deg)`,
                borderRadius: 2,
              }}
            />
          );
        })}

      <div
        style={{
          display: "flex",
          gap: FINAL_SCORE_GAP_PX,
          alignItems: "flex-start",
        }}
      >
        <DoctorFace
          color={scoreColor}
          mood={getDoctorMood(currentScore)}
          size={FINAL_SCORE_FACE_SIZE_PX}
        />
        <div>
          <div>
            <span
              style={{
                color: scoreColor,
                fontWeight: 500,
                fontSize: FINAL_SCORE_FONT_SIZE_PX,
                fontFamily: FONT_FAMILY,
                display: "inline-block",
                minWidth: "3ch",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {currentScore}
            </span>
            <span
              style={{
                color: MUTED_COLOR,
                fontSize: FINAL_SCORE_LABEL_FONT_SIZE_PX,
                fontFamily: FONT_FAMILY,
              }}
            >
              {` / ${PERFECT_SCORE}  `}
            </span>
            <span
              style={{
                color: scoreColor,
                fontSize: FINAL_SCORE_LABEL_FONT_SIZE_PX,
                fontFamily: FONT_FAMILY,
              }}
            >
              {getScoreLabel(currentScore)}
            </span>
          </div>
          <div
            style={{
              width: FINAL_SCORE_BAR_WIDTH_PX,
              height: FINAL_SCORE_BAR_HEIGHT_PX,
              marginTop: 8,
              backgroundColor: EMPTY_BAR_COLOR,
            }}
          >
            <div
              style={{
                width: `${currentScore}%`,
                height: "100%",
                backgroundColor: scoreColor,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: FINAL_SCORE_URL_FONT_SIZE_PX,
              fontFamily: FONT_FAMILY,
              color: MUTED_COLOR,
            }}
          >
            {REACT_DOCTOR_URL}
          </div>
        </div>
      </div>
    </div>
  );
};
