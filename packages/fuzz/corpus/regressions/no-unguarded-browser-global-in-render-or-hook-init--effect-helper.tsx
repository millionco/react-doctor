// rule: no-unguarded-browser-global-in-render-or-hook-init
// verdict: pass
// weakness: a capitalized helper inside an effect was treated as a server render
// source: reduced local regression
import { useEffect } from "react";
export const Panel = () => {
  useEffect(() => {
    const ReadSize = () => window.innerWidth;
    ReadSize();
  }, []);
  return null;
};
