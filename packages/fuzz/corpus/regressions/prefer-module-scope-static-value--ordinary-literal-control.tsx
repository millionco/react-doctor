// rule: prefer-module-scope-static-value
// verdict: fail
// weakness: library-idiom
// source: independently synthetic ordinary literal control
export const StaticLabels = () => {
  const labels = ["open", "closed"];
  return (
    <section>
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </section>
  );
};
