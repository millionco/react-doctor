// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useEffect, useState } from "react";

export function Screen() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Viewport />;
}

function Viewport() {
  return <output>{window.innerWidth}</output>;
}
