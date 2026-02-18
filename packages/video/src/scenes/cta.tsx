import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BACKGROUND_COLOR, MUTED_COLOR, TEXT_COLOR } from "../constants";
import { fontFamily } from "../utils/font";

const FADE_IN_FRAMES = 10;
const COMMAND_DELAY_FRAMES = 15;

export const Cta = () => {
  const frame = useCurrentFrame();

  const logoOpacity = interpolate(frame, [0, FADE_IN_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const commandOpacity = interpolate(
    frame,
    [COMMAND_DELAY_FRAMES, COMMAND_DELAY_FRAMES + FADE_IN_FRAMES],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BACKGROUND_COLOR,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
          opacity: logoOpacity,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Img src={staticFile("react-doctor-icon.svg")} width={96} height={96} />
          <span style={{ fontFamily, fontSize: 72, color: TEXT_COLOR, fontWeight: 600 }}>
            react-doctor
          </span>
        </div>

        <div
          style={{
            opacity: commandOpacity,
            fontFamily,
            fontSize: 52,
            color: MUTED_COLOR,
            padding: "20px 40px",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderRadius: 12,
          }}
        >
          <span style={{ color: TEXT_COLOR }}>$ </span>npx -y react-doctor@latest
        </div>
      </div>
    </AbsoluteFill>
  );
};
