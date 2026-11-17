// rule: no-call-component-as-function
// verdict: fail
export const SymbolList = ({ entries }) => (
  <main>
    {entries.map(([label, Symbol]) => (
      <button key={label} onClick={() => Symbol({ label })}>
        <Symbol label={label} />
      </button>
    ))}
  </main>
);
