// rule: no-adjust-state-on-prop-change
// weakness: context-masked-retirement
// source: synthetic
// verdict: pass
import { useEffect as useTokenRetirementEffect, useState as useTokenRetirementState } from "react";
export const FuzzTokenRetirementNotice = ({ activeToken }) => {
  const currentToken = activeToken;
  const [notice, setNotice] = useTokenRetirementState(null);
  useTokenRetirementEffect(() => {
    setNotice((previous) => (previous && previous.token !== currentToken ? null : previous));
  }, [currentToken]);
  const matches = notice?.token === currentToken;
  const message = matches ? notice?.message : undefined;
  return (
    <button onClick={() => setNotice({ token: currentToken, message: "retry" })}>{message}</button>
  );
};
