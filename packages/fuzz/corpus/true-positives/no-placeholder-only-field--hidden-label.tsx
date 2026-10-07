// rule: no-placeholder-only-field
// weakness: hidden-label
// source: accessibility parity review
// verdict: fail

export const EmailField = () => (
  <>
    <label hidden htmlFor="email">
      Email
    </label>
    <input id="email" placeholder="Email" />
  </>
);
