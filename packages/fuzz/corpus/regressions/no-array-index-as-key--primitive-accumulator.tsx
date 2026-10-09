// rule: no-array-index-as-key
// verdict: safe
export const Scale = ({ amounts }) => {
  let total = 0;
  return amounts.map((amount, index) => {
    total += amount;
    return (
      <div key={index}>
        <span>{total}</span>
      </div>
    );
  });
};
