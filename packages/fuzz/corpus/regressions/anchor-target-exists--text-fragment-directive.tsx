// rule: anchor-target-exists
// weakness: special-syntax
// source: Cursor Bugbot PR #1561
// verdict: pass

export const TextFragmentLink = () => <a href="#:~:text=React%20Doctor">React Doctor</a>;

export const CombinedTextFragmentLink = () => (
  <>
    <a href="#about:~:text=React%20Doctor">React Doctor</a>
    <main id="about" />
  </>
);
