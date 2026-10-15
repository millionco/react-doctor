// rule: no-array-index-as-key
// verdict: pass
// weakness: library-idiom
// source: synthetic fixed numeric option identities
export const SeatCount = ({ limits }) => (
  <select>
    {Array.from({ length: limits.seats }, (_, index) => (
      <option key={index + 1} value={index + 1}>
        {index + 1}
      </option>
    ))}
  </select>
);
