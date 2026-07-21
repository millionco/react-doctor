// rule: no-invisible-focus-control
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: fail

export const FilePicker = () => (
  <input type="file" className="opacity-0 focus:opacity-100 focus:!opacity-0" />
);
