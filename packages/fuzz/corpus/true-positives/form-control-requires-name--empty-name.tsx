// rule: form-control-requires-name
// weakness: static-empty-value
// source: WHATWG form entry-list contract audit after PR #1337 parity
// verdict: fail

export const ProfileFields = () => (
  <form>
    <input name="" />
    <textarea name={null} />
    <input type={undefined} />
  </form>
);
