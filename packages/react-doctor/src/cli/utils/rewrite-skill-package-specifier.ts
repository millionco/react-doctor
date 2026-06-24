// Rewrite the skill's runnable `npx react-doctor …` commands to a specific
// package specifier so a pkg.pr.new preview build ships a skill that drives the
// previewed branch (e.g. `npx https://pkg.pr.new/react-doctor@<sha> …`) instead
// of the published `react-doctor@latest`. Only `npx` invocations are touched —
// prose mentions of the command name stay as-is — and the `@latest` form is
// replaced first so the bare-name pass can't double-rewrite the URL it produced.
export const rewriteSkillPackageSpecifier = (markdown: string, specifier: string): string =>
  markdown
    .replaceAll("react-doctor@latest", specifier)
    .replace(/\bnpx react-doctor(?![@\w-])/g, `npx ${specifier}`);
