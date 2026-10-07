// rule: no-img-without-dimensions
// weakness: known-non-sizing-tailwind
// source: PR #1337 parity detector audit
// verdict: fail

export const Avatar = () => (
  <img className="object-cover rounded-lg opacity-50 shadow-lg mx-auto" src="/avatar.jpg" alt="" />
);
