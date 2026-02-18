import { Series } from "remotion";
import { Cta } from "../scenes/cta";
import { LeaderboardWithClimb } from "../scenes/leaderboard-with-climb";

const SCENE_LEADERBOARD_DURATION_FRAMES = 165;
const SCENE_CTA_DURATION_FRAMES = 90;

export const Main = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={SCENE_LEADERBOARD_DURATION_FRAMES}>
        <LeaderboardWithClimb />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_CTA_DURATION_FRAMES}>
        <Cta />
      </Series.Sequence>
    </Series>
  );
};
