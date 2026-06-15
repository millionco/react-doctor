import { Composition } from "remotion";
import { Main } from "./compositions/main";
import { Security } from "./compositions/security";
import {
  SECURITY_TOTAL_DURATION,
  TOTAL_DURATION,
  VIDEO_FPS,
  VIDEO_HEIGHT_PX,
  VIDEO_WIDTH_PX,
} from "./constants";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Main"
        component={Main}
        durationInFrames={TOTAL_DURATION}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH_PX}
        height={VIDEO_HEIGHT_PX}
      />
      <Composition
        id="Security"
        component={Security}
        durationInFrames={SECURITY_TOTAL_DURATION}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH_PX}
        height={VIDEO_HEIGHT_PX}
      />
    </>
  );
};
