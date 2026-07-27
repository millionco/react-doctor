import {
  animate,
  domAnimation,
  LazyMotion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlaybackControls, type TimelinePlaybackControls } from "./components/playback-controls";
import { ClaudeTimeline } from "./components/claude-timeline";
import { V2Timeline } from "./components/v2-timeline";
import { TOTAL_DURATION_FRAMES, VIDEO_FPS, VIDEO_HEIGHT_PX, VIDEO_WIDTH_PX } from "./constants";
import { V2_TOTAL_DURATION_FRAMES } from "./v2-constants";

const subscribeViewport = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

const getViewportWidth = () => window.innerWidth;
const getViewportHeight = () => window.innerHeight;
const getServerViewportWidth = () => VIDEO_WIDTH_PX;
const getServerViewportHeight = () => VIDEO_HEIGHT_PX;

export const VideoWorkspace = () => {
  const playhead = useMotionValue(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const playbackRef = useRef<TimelinePlaybackControls | null>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const searchParameters = new URLSearchParams(window.location.search);
  const isCaptureMode = searchParameters.get("real") === "true";
  const isClaudeVariant = searchParameters.get("variant") === "claude";
  const totalDurationFrames = isClaudeVariant ? TOTAL_DURATION_FRAMES : V2_TOTAL_DURATION_FRAMES;
  const totalDurationSeconds = totalDurationFrames / VIDEO_FPS;
  const canAutoplay = isCaptureMode || !shouldReduceMotion;
  const viewportWidth = useSyncExternalStore(
    subscribeViewport,
    getViewportWidth,
    getServerViewportWidth,
  );
  const viewportHeight = useSyncExternalStore(
    subscribeViewport,
    getViewportHeight,
    getServerViewportHeight,
  );
  const canvasScale = Math.min(viewportWidth / VIDEO_WIDTH_PX, viewportHeight / VIDEO_HEIGHT_PX);

  useMotionValueEvent(playhead, "change", (seconds) => {
    setCurrentFrame(Math.min(totalDurationFrames, seconds * VIDEO_FPS));
  });

  useEffect(() => {
    const playback = animate(playhead, totalDurationSeconds, {
      duration: totalDurationSeconds,
      ease: "linear",
    });
    playbackRef.current = playback;

    if (!canAutoplay) playback.pause();

    return () => {
      playbackRef.current = null;
      playback.stop();
    };
  }, [canAutoplay, playhead, totalDurationSeconds]);

  const currentSeconds = currentFrame / VIDEO_FPS;

  return (
    <LazyMotion features={domAnimation} strict>
      <main className="video-workspace">
        <h1 className="sr-only">React Doctor workflow animation</h1>

        {!isCaptureMode && (
          <PlaybackControls
            canAutoplay={canAutoplay}
            currentSeconds={currentSeconds}
            durationSeconds={totalDurationSeconds}
            playbackRef={playbackRef}
          />
        )}

        <div
          className="video-frame"
          style={{
            width: VIDEO_WIDTH_PX * canvasScale,
            height: VIDEO_HEIGHT_PX * canvasScale,
          }}
        >
          <div
            className="video-stage"
            data-video-stage=""
            style={{
              width: VIDEO_WIDTH_PX,
              height: VIDEO_HEIGHT_PX,
              transform: `scale(${canvasScale})`,
            }}
          >
            {isClaudeVariant ? (
              <ClaudeTimeline frame={currentFrame} />
            ) : (
              <V2Timeline frame={currentFrame} />
            )}
          </div>
        </div>
      </main>
    </LazyMotion>
  );
};
