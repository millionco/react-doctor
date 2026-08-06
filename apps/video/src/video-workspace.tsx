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
import { ThreeTimeline } from "./components/three-timeline";
import { VIDEO_FPS, VIDEO_HEIGHT_PX, VIDEO_WIDTH_PX } from "./constants";
import { THREE_TOTAL_DURATION_FRAMES } from "./three-constants";

const subscribeViewport = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

const getViewportWidth = () => window.innerWidth;
const getViewportHeight = () => window.innerHeight;
const getServerViewportWidth = () => VIDEO_WIDTH_PX;
const getServerViewportHeight = () => VIDEO_HEIGHT_PX;

export const VideoWorkspace = () => {
  const searchParameters = new URLSearchParams(window.location.search);
  const isCaptureMode = searchParameters.get("real") === "true";
  const totalDurationFrames = THREE_TOTAL_DURATION_FRAMES;
  const requestedFrameParameter = searchParameters.get("frame");
  const requestedFrame = Number(requestedFrameParameter);
  const hasRequestedFrame =
    requestedFrameParameter !== null && Number.isFinite(requestedFrame) && requestedFrame >= 0;
  const isManualFrame = searchParameters.get("manual") === "true";
  const isStillFrame = isManualFrame || hasRequestedFrame;
  const initialFrame = isStillFrame ? Math.min(requestedFrame, totalDurationFrames) : 0;
  const playhead = useMotionValue(initialFrame / VIDEO_FPS);
  const [currentFrame, setCurrentFrame] = useState(initialFrame);
  const playbackRef = useRef<TimelinePlaybackControls | null>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
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
    if (!isManualFrame) return;
    const setManualFrame = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "number") return;
      setCurrentFrame(Math.max(0, Math.min(totalDurationFrames, event.detail)));
    };
    window.addEventListener("react-doctor:set-frame", setManualFrame);
    return () => window.removeEventListener("react-doctor:set-frame", setManualFrame);
  }, [isManualFrame, totalDurationFrames]);

  useEffect(() => {
    if (isStillFrame) return;

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
  }, [canAutoplay, isStillFrame, playhead, totalDurationSeconds]);

  const currentSeconds = currentFrame / VIDEO_FPS;

  return (
    <LazyMotion features={domAnimation} strict>
      <main className="video-workspace">
        <h1 className="sr-only">React Doctor for Three.js performance animation</h1>

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
            <ThreeTimeline frame={currentFrame} />
          </div>
        </div>
      </main>
    </LazyMotion>
  );
};
