// rule: no-array-index-as-key
// weakness: wrapper-insertion
// source: synthetic native parity regression
export const List = ({ items }) => (
  <div>
    {items.map(({ name }, index) => (
      <p key={`${name}-${index}`}>{name}</p>
    ))}
  </div>
);
