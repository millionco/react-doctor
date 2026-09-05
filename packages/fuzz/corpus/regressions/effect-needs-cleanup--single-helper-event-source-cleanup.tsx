// rule: effect-needs-cleanup
// weakness: control-flow
// source: Synthetic native parity regression
import { useEffect } from "react";
export function Child({ url }) {
  useEffect(() => {
    let connection = null;
    const connect = () => {
      connection = new EventSource(url);
    };
    connect();
    return () => connection?.close();
  }, [url]);
  return null;
}
