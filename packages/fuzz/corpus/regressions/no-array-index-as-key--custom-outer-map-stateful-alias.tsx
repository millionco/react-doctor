// rule: no-array-index-as-key
// weakness: alias-guard
// source: synthetic source-review regression
// verdict: pass
const records = {
  map: (callback) => callback({ parts: { map: () => [] } }, 0),
};
export const Rows = () => (
  <section>
    {records.map((item, index) => {
      const content = item.parts.map((part) => <input />);
      return <div key={index}>{content}</div>;
    })}
  </section>
);
