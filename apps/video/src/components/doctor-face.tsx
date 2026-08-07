export interface DoctorFaceProps {
  color: string;
  mood: "happy" | "neutral" | "sad";
  size: number;
}

export const DoctorFace = ({ color, mood, size }: DoctorFaceProps) => {
  const borderWidth = Math.max(2, size * 0.04);
  const eyeSize = size * 0.12;
  const eyeGap = size * 0.22;
  const mouthWidth = size * 0.25;
  const mouthHeight = size * 0.12;

  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${borderWidth}px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: size * 0.12,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", gap: eyeGap, height: eyeSize * 1.4, alignItems: "center" }}>
        {mood === "happy" ? (
          <>
            <div
              style={{
                width: eyeSize * 1.4,
                height: eyeSize * 0.7,
                borderBottom: `${borderWidth}px solid ${color}`,
                borderRadius: `${eyeSize}px ${eyeSize}px 0 0`,
              }}
            />
            <div
              style={{
                width: eyeSize * 1.4,
                height: eyeSize * 0.7,
                borderBottom: `${borderWidth}px solid ${color}`,
                borderRadius: `${eyeSize}px ${eyeSize}px 0 0`,
              }}
            />
          </>
        ) : (
          <>
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: "50%",
                backgroundColor: color,
              }}
            />
            <div
              style={{
                width: eyeSize,
                height: eyeSize,
                borderRadius: "50%",
                backgroundColor: color,
              }}
            />
          </>
        )}
      </div>

      <div
        style={{
          width: mouthWidth,
          height: mouthHeight + borderWidth,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {mood === "happy" && (
          <div
            style={{
              width: mouthWidth,
              height: mouthHeight,
              borderBottom: `${borderWidth}px solid ${color}`,
              borderLeft: `${borderWidth}px solid ${color}`,
              borderRight: `${borderWidth}px solid ${color}`,
              borderRadius: `0 0 ${mouthWidth}px ${mouthWidth}px`,
            }}
          />
        )}
        {mood === "neutral" && (
          <div
            style={{
              width: mouthWidth,
              height: 0,
              borderBottom: `${borderWidth}px solid ${color}`,
            }}
          />
        )}
        {mood === "sad" && (
          <div
            style={{
              width: mouthWidth,
              height: mouthHeight,
              borderTop: `${borderWidth}px solid ${color}`,
              borderLeft: `${borderWidth}px solid ${color}`,
              borderRight: `${borderWidth}px solid ${color}`,
              borderRadius: `${mouthWidth}px ${mouthWidth}px 0 0`,
            }}
          />
        )}
      </div>
    </div>
  );
};
