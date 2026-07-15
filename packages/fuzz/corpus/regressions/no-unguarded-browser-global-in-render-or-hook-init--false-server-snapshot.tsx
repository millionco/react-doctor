// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: alias-guard
// source: Jumper trials fix-react-jumperexchange-jumper__Lx5Cukx and __PNzVTWy / PR #1294
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const useServerReady = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export const AnimatedBackgroundImage = () => {
  const snapshot = useServerReady();
  const serverReady = snapshot;
  return serverReady && document.createElement("video").canPlayType("video/mp4");
};
