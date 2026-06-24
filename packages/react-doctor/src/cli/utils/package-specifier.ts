// The npm specifier `install` adds as the dev-dependency and the package script,
// and that the bundled skill's `npx` commands reference. Defaults to the
// published `react-doctor@latest`; a pkg.pr.new preview build overrides it (via
// the REACT_DOCTOR_PACKAGE_SPECIFIER build env baked in vite.config.ts) with its
// own immutable tarball URL, and the skill markdown is rewritten to match at
// build time — so a beta tester exercises the previewed branch end to end
// instead of silently falling back to the released package.
export const PACKAGE_SPECIFIER =
  process.env.REACT_DOCTOR_PACKAGE_SPECIFIER ?? "react-doctor@latest";
