// rule: no-hydration-branch-on-browser-global
// weakness: reachability
// source: adversarial review

import React, { useEffect, useState } from "react";

export const DeadWrite = () => {
  let show = false;
  if (typeof window !== "undefined") {
    if (false) show = true;
  }
  return show ? <Client /> : <Server />;
};

const useRuntime = () => {
  const [runtime] = useState(typeof window === "undefined" ? "server" : "client");
  return { runtime };
};

export const MountGatedConsumer = () => {
  const { runtime } = useRuntime();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return runtime ? <Client /> : <Server />;
};

export const SuppressedConsumer = () => {
  const { runtime } = useRuntime();
  return <span suppressHydrationWarning>{runtime}</span>;
};
