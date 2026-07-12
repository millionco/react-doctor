// rule: no-async-effect-callback
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
export const AsyncRunner = ({
  useEffect,
}: {
  useEffect: (callback: () => Promise<void>) => void;
}) => {
  useEffect(async () => {
    await synchronize();
  });
  return null;
};
