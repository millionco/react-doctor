// rule: effect-needs-cleanup
// weakness: control-flow
// source: Synthetic native parity regression
import { useEffect, useRef } from "react";
export function Child({ url }) {
  const timer = useRef(null);
  useEffect(() => {
    let connection = null;
    let mounted = true;
    const connect = () => {
      if (!mounted) return;
      connection = new EventSource(url);
      connection.onerror = () => {
        if (!mounted) return;
        connection?.close();
        connection = null;
        timer.current = setTimeout(() => {
          if (mounted) connect();
        }, 1000);
      };
    };
    connect();
    return () => {
      mounted = false;
      connection?.close();
      clearTimeout(timer.current);
    };
  }, [url]);
  return null;
}
