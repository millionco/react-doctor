// rule: no-duplicate-static-id-reference
// weakness: unicode-tokenization
// source: synthetic standards-derived regression
// verdict: pass
export const UnicodeIdIdentity = () => (
  <div aria-describedby="field">
    <span id="field" />
    <span id={"\u00a0field"} />
    <span id={"field\ufeff"} />
  </div>
);
