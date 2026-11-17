// rule: no-call-component-as-function
// verdict: pass
export const SymbolList = ({ entries }) => (
  <main>
    {entries.map(([label, Symbol]) => (
      <button key={label}>
        <Symbol label={label} />
      </button>
    ))}
  </main>
);
