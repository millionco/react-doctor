// rule: no-transition-all
// weakness: library-idiom
// source: GitHub issue #1700
// verdict: pass

export const EntrancePanel = () => (
  <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">Ready</div>
);
