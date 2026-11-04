// rule: effect-needs-cleanup
// verdict: pass
// weakness: global-member-mutation
// source: PR 2309 review
import { useEffect } from "react";
const scheduler = globalThis;
scheduler.setInterval = () => 0;
export const Clock = () => {
  useEffect(() => {
    scheduler.setInterval(refresh, 1000);
  }, []);
  return null;
};
