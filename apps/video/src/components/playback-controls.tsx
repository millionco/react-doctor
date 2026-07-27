import type { RefObject } from "react";
import { formatPlaybackTime } from "../utils/format-playback-time";

export interface TimelinePlaybackControls {
  pause: () => void;
  play: () => void;
  stop: () => void;
  time: number;
}

export interface PlaybackControlsProps {
  canAutoplay: boolean;
  currentSeconds: number;
  durationSeconds: number;
  playbackRef: RefObject<TimelinePlaybackControls | null>;
}

export const PlaybackControls = ({
  canAutoplay,
  currentSeconds,
  durationSeconds,
  playbackRef,
}: PlaybackControlsProps) => {
  const resumePlayback = () => {
    const playback = playbackRef.current;
    if (!playback || !canAutoplay) return;
    if (playback.time >= durationSeconds) playback.time = 0;
    playback.play();
  };

  return (
    <div className="playback-controls">
      <span className="playback-time">{formatPlaybackTime(currentSeconds)}</span>
      <input
        aria-label="Video timeline"
        type="range"
        min={0}
        max={durationSeconds}
        step={0.01}
        value={currentSeconds}
        onPointerDown={() => playbackRef.current?.pause()}
        onChange={(event) => {
          if (playbackRef.current) {
            playbackRef.current.time = Number(event.currentTarget.value);
          }
        }}
        onPointerUp={resumePlayback}
        onPointerCancel={resumePlayback}
        onBlur={resumePlayback}
      />
    </div>
  );
};
