// rule: advanced-event-handler-refs
// weakness: library-idiom
// source: PR #1362 Cursor Bugbot review

import { useEffectEvent } from "@rocket.chat/fuselage-hooks";
import { useEffect } from "react";

export const ScrollListener = () => {
  const onScroll = useEffectEvent(() => syncState());

  useEffect(() => {
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  return null;
};
