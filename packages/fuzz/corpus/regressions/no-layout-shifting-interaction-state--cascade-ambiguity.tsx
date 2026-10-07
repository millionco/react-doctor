// rule: no-layout-shifting-interaction-state
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const StableActions = () => (
  <>
    <button className="p-4 hover:p-4">Save</button>
    <button className="p-4 hover:p-6 hover:p-8">Cancel</button>
    <button className="p-4 hover:!p-6 hover:!p-8">More</button>
    <button className="p-4 hover:p-[var(--interactive-space)]">Help</button>
  </>
);
