// rule: no-array-index-as-key
// verdict: pass
// weakness: literal-provenance
// source: independently invented public literal JSON regression
export const Captions = () => (
  <div>
    {JSON.parse('["East",7,false,null]').map((item, index) => (
      <p key={index}>{item}</p>
    ))}
  </div>
);
