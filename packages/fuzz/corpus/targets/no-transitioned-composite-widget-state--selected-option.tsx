// rule: no-transitioned-composite-widget-state

export const Option = ({ selected }) => (
  <div
    role="option"
    aria-selected={selected ? "true" : "false"}
    className="bg-[#fff] transition-colors aria-selected:bg-[#000]"
  >
    Value
  </div>
);
