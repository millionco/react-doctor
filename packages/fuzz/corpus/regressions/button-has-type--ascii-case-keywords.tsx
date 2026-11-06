// rule: button-has-type
// weakness: name-heuristic
// source: HTML enumerated attribute keyword matching
export const CancelButton = () => (
  <form>
    <button type="BUTTON">Cancel</button>
  </form>
);
