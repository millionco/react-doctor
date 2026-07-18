// rule: rendering-hydration-no-flicker
// weakness: control-flow
// source: react-bench trial 9tTzDBK

import { useEffect, useMemo, useState } from "react";

export const Background = ({ mime, src }) => {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const isPlayable = useMemo(
    () => Boolean(hasMounted && document.createElement("video").canPlayType(mime)),
    [hasMounted, mime],
  );

  return isPlayable ? <video src={src} /> : <img src={src} />;
};
