// Whether a resolved Expo SDK major (`ExpoCheckContext.expoSdkMajor`) is
// known AND at least `minMajor`. Conservative on `null`: an unresolvable SDK returns
// `false` so SDK-gated checks stay quiet rather than false-positive on a
// project whose target SDK couldn't be determined. (The inverse of
// `isReactAtLeast`'s optimistic-on-null policy — there, gating wrong skips
// a rule; here, gating wrong would warn on an SDK the finding predates.)
export const isExpoSdkAtLeast = (expoSdkMajor: number | null, minMajor: number): boolean =>
  expoSdkMajor !== null && expoSdkMajor >= minMajor;
