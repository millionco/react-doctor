// verdict: pass
// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: PR 1522 replacement Group B parity audit
import { useEffect, useRef } from "react";

interface RetainedConnectionProps {
  url: string;
}

export const RetainedConnection = ({ url }: RetainedConnectionProps) => {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(url);
    socketRef.current = socket;

    return () => socket.close();
  }, [url]);

  return null;
};
