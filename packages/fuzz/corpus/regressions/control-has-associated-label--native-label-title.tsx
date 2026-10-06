// rule: control-has-associated-label
// weakness: library-idiom
// source: saved candidate audit; radio name verified in Helium accessibility tree
// verdict: pass
export const Rating = () => (
  <>
    <input id="rating" type="radio" />
    <label htmlFor="rating" title="Two stars" />
  </>
);
