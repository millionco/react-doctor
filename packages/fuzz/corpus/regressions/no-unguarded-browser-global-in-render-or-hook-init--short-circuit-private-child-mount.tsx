// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useEffect, useState } from "react";

export function Screen() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <section>
      <button onClick={() => setMounted(false)}>Hide</button>
      {mounted && <Viewport />}
    </section>
  );
}

const Viewport = () => <output>{window.innerWidth}</output>;
