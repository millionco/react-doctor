// rule: no-controlled-input-value-without-state-update
// weakness: semantic-intent
// source: PR review of millionco/react-doctor#1000

export const StaticSearch = () => (
  <>
    <input onChange={() => undefined} value="Search..." />
    <textarea onChange={() => null} value="Search..." />
  </>
);
