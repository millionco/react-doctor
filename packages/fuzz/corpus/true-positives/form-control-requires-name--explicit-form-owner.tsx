// rule: form-control-requires-name
// weakness: explicit-form-owner
// source: WHATWG form-owner contract audit
// verdict: fail

export const ProfileFields = () => (
  <>
    <form id="profile" />
    <input form="profile" />
  </>
);
