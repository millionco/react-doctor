import { useLayoutEffect, useState } from "react";

export const VisualContext = () => {
  const [visualContext, setVisualContext] = useState("");
  useLayoutEffect(() => {
    const nextVisualContext = document.body.className;
    setVisualContext((previousVisualContext) =>
      previousVisualContext === nextVisualContext ? previousVisualContext : nextVisualContext,
    );
  });
  return <output>{visualContext}</output>;
};
