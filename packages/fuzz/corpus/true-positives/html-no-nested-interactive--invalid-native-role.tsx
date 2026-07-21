// rule: html-no-nested-interactive
// verdict: fail
// weakness: invalid-role-native-fallback

export const Search = () => (
  <button role="unsupported future-role">
    <input aria-label="Search" />
  </button>
);
