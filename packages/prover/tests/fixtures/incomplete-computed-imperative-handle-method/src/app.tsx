import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface PlayerHandle {
  pause(): void;
  play(): void;
}

interface PlayerProperties {
  ref?: Ref<PlayerHandle>;
}

const Player = ({ ref }: PlayerProperties) => {
  useImperativeHandle(ref, () => ({
    pause: () => undefined,
    play: () => undefined,
  }));
  return <output>player</output>;
};

export const Application = () => {
  const playerRef = useRef<PlayerHandle | null>(null);
  const methodName: keyof PlayerHandle = "play";
  return (
    <button type="button" onClick={() => playerRef.current?.[methodName]()}>
      <Player ref={playerRef} />
    </button>
  );
};
