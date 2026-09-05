// rule: effect-needs-cleanup
// weakness: control-flow
// source: Synthetic native parity regression
import { useEffect } from "react";
export function Child({ channel, handler }) {
  useEffect(() => {
    channel.on("change", handler).subscribe(handler);
  }, [channel, handler]);
  return null;
}
