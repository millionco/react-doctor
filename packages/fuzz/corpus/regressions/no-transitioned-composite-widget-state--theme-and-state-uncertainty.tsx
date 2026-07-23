// rule: no-transitioned-composite-widget-state
// weakness: dynamic-computed
// source: adversarial audit of deterministic design rules
// verdict: pass

export const Option = ({ selected, loading }) => (
  <>
    <div
      role="option"
      aria-selected={selected ? "true" : "false"}
      className="bg-white transition-colors aria-selected:bg-black"
    >
      Theme colors
    </div>
    <div
      role="option"
      aria-selected={selected ? "true" : "false"}
      data-state={loading ? "selected" : "idle"}
      className="bg-[#fff] transition-colors data-[state=selected]:bg-[#000]"
    >
      Loading state
    </div>
    <div
      role="option"
      aria-selected={selected ? "true" : "false"}
      className="bg-[#fff] transition-colors ARIA-selected:bg-[#000]"
    >
      Invalid variant
    </div>
  </>
);
