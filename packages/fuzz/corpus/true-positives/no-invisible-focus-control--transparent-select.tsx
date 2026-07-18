// rule: no-invisible-focus-control
// weakness: other
// source: react-bench-5 FN audit

export const TimezoneSelect = () => (
  <div className="relative">
    <select className="absolute inset-0 opacity-0">
      <option>UTC</option>
    </select>
    <span>UTC</span>
  </div>
);
