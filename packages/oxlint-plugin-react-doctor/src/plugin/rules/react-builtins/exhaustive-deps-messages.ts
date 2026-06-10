// User-facing diagnostic strings emitted by the `exhaustive-deps` rule.
// Kept beside the rule (same bucket directory) so authors editing
// wording don't need to scroll past 900 lines of analysis logic;
// otherwise behavior-neutral.

export const buildMissingDepMessage = (hookName: string, depName: string): string =>
  `\`${hookName}\` can run with a stale \`${depName}\` & show your users old data.`;

export const buildUnnecessaryDepMessage = (hookName: string, depName: string): string =>
  `\`${hookName}\` re-runs whenever \`${depName}\` changes even though it never uses it.`;

export const buildDuplicateDepMessage = (hookName: string, depName: string): string =>
  `\`${hookName}\` lists \`${depName}\` twice, adding dependency-array noise without changing when it runs.`;

export const buildLiteralDepMessage = (hookName: string): string =>
  `A literal in \`${hookName}\`'s dependency array never changes, so it adds noise without protecting against stale values.`;

export const buildRefCurrentDepMessage = (hookName: string, depName: string): string =>
  `\`${hookName}\` won't re-run when \`${depName}\` changes, since a ref never triggers a redraw.`;

export const buildNonArrayDepsMessage = (hookName: string): string =>
  `\`${hookName}\`'s dependencies can't be checked because its second argument isn't an inline array, so stale values can slip through.`;

export const buildMissingDepArrayMessage = (hookName: string): string =>
  `\`${hookName}\` re-runs on every render with no dependency array.`;

export const buildMissingCallbackMessage = (hookName: string): string =>
  `\`${hookName}\` crashes without a function as its first argument.`;

export const buildEffectEventDepMessage = (): string =>
  `A function from \`useEffectEvent\` is stable, so listing it adds noise and defeats the event/dependency split.`;

export const buildSpreadDepMessage = (hookName: string): string =>
  `A spread in \`${hookName}\`'s dependency array hides the actual deps, so stale values can slip through.`;

export const buildComplexDepMessage = (hookName: string): string =>
  `A complex expression in \`${hookName}\`'s dependency array hides the real value, so stale values can slip through.`;

export const buildAsyncEffectMessage = (hookName: string): string =>
  `\`${hookName}\` was given an async function, so its cleanup breaks.`;

export const buildUnknownCallbackMessage = (hookName: string): string =>
  `\`${hookName}\`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.`;

export const buildUnstableDepMessage = (hookName: string, depName: string): string =>
  `\`${depName}\` is rebuilt every render, so \`${hookName}\` runs every time.`;

export const buildSetStateWithoutDepsMessage = (hookName: string, setterName: string): string =>
  `\`${hookName}\` calls \`${setterName}\` with no dependency array, so it can loop forever & freeze the component.`;

export const buildRefCleanupMessage = (depName: string): string =>
  `Your cleanup may read the wrong node since the ref \`${depName}\` can change before it runs.`;

export const buildAssignmentMessage = (name: string): string =>
  `Assigning to \`${name}\` inside a hook is thrown away after each render, so the next render reads the old value.`;
