// rule: no-transitioned-composite-widget-state
// weakness: dynamic-computed
// source: adversarial audit of deterministic design rules
// verdict: pass

const ALWAYS_SELECTED = true;
const NEVER_SELECTED = false;

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
    <div
      role="option"
      aria-selected={selected ? "true" : "false"}
      className="forced-colors:bg-[#fff] forced-colors:transition-colors forced-colors:aria-selected:bg-[#000]"
    >
      Forced colors
    </div>
    <div
      role="option"
      aria-selected={ALWAYS_SELECTED ? "true" : "false"}
      className="bg-[#fff] transition-colors aria-selected:bg-[#000]"
    >
      Constant true
    </div>
    <div
      role="option"
      aria-selected={NEVER_SELECTED ? "true" : "false"}
      className="bg-[#fff] transition-colors aria-selected:bg-[#000]"
    >
      Constant false
    </div>
    {NEVER_SELECTED ? (
      <div
        role="option"
        aria-selected={selected ? "true" : "false"}
        className="bg-[#fff] transition-colors aria-selected:bg-[#000]"
      >
        Unreachable
      </div>
    ) : null}
  </>
);
