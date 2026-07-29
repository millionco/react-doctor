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

export const DeadConditionalArms = () => {
  const consequent = false ? typeof window !== "undefined" : false;
  const alternate = true ? false : typeof window !== "undefined";
  return consequent || alternate ? <Client /> : <Server />;
};

export const StaticallyOverwritten = () => {
  let show = false;
  if (typeof window !== "undefined") show = true;
  if (true) show = false;
  return show ? <Client /> : <Server />;
};

export const StableHelperWrite = () => {
  let show = false;
  const preserve = () => {
    show = false;
  };
  if (typeof window !== "undefined") preserve();
  return show ? <Client /> : <Server />;
};
