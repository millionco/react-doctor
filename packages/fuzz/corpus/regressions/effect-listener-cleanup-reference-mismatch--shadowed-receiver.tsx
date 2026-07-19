// rule: effect-listener-cleanup-reference-mismatch
// weakness: alias-guard
// source: PR #1365 deep audit

export const Subscriber = ({ first, second }: Props) => {
  useEffect(() => {
    {
      const source = first;
      source.subscribe(() => consume());
    }
    return () => {
      const source = second;
      source.unsubscribe(() => consume());
    };
  }, [first, second]);
  return null;
};
