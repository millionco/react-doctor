// rule: no-derived-state
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";

export const useAnnouncement = (acknowledged: "yes" | "no", message?: string) => {
  const [lastMessage, setLastMessage] = useState(message);
  useEffect(() => {
    if (message) setLastMessage(message);
  }, [message]);
  useEffect(() => {
    if (acknowledged === "yes") setLastMessage(undefined);
  }, [acknowledged]);
  return lastMessage;
};
