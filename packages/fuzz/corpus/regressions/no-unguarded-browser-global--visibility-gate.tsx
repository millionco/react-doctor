// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: control-flow
// source: PR #1000 corpus sweep (jumper-exchange confetti: show* flag is false during SSR)
import { useState } from "react";
import Confetti from "react-confetti";

export const GoldenModal = () => {
  const [showConfetti, setShowConfetti] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const isDrawer = navOpen && window.matchMedia("(max-width: 768px)").matches;
  return (
    <div data-drawer={isDrawer} onClick={() => setShowConfetti(true)}>
      {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}
      <button onClick={() => setNavOpen(true)}>open</button>
    </div>
  );
};
