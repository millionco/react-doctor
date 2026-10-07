// rule: no-invisible-focus-control
// weakness: cascade-ambiguity
// source: Tailwind CSS utility-conflict documentation
// verdict: pass

export const FilePicker = () => <input type="file" className="opacity-100 opacity-0" />;
