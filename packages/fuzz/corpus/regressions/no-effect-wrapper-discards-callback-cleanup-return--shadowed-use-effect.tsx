// rule: no-effect-wrapper-discards-callback-cleanup-return
// weakness: identity-provenance
// source: PR #1000 deep adversarial audit
const useEffect = (callback: () => void) => callback();

export const useWrapped = (effect: EffectCallback) => {
  useEffect(() => {
    effect();
  });
};
