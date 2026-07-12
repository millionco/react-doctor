// rule: no-fetch-in-effect
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
export const RequestRunner = ({
  engine,
}: {
  engine: { useEffect: (callback: () => void) => void };
}) => {
  engine.useEffect(() => {
    fetch("/api/profile");
  });
  return null;
};
