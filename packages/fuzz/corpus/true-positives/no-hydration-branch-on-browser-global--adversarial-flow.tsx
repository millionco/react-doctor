// rule: no-hydration-branch-on-browser-global
// weakness: dataflow
// source: adversarial review

import { useState } from "react";

const useRuntime = () => {
  const [runtime] = useState(typeof window === "undefined" ? "server" : "client");
  return [runtime] as const;
};

const renderContent = () => (typeof window !== "undefined" ? <Client /> : <Server />);

export const Page = ({ enabled }: { enabled: boolean }) => {
  let show = false;
  const enable = () => {
    show = true;
  };
  if (typeof window !== "undefined") enable();
  const [runtime] = useRuntime();
  const possibleNaN = enabled ? (typeof window !== "undefined" ? Number("x") : 0) : 0;
  return (
    <main>
      {show ? <Client /> : <Server />}
      {runtime ? <Client /> : <Server />}
      {possibleNaN === possibleNaN ? <Same /> : <Different />}
      {renderContent()}
    </main>
  );
};
