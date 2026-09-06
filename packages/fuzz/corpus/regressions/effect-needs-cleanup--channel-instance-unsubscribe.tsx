// rule: effect-needs-cleanup
// weakness: cleanup can unsubscribe the channel instance directly
// source: handwritten native parity regression
// verdict: pass

import { useEffect } from "react";

export const Feed = ({ client }) => {
  useEffect(() => {
    const channel = client.channel("updates");
    channel.subscribe();
    return () => channel.unsubscribe();
  }, []);
  return null;
};
