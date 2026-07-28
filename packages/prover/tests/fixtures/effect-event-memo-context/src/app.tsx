import { createContext, memo, useContext, useEffect, useEffectEvent, useState } from "react";

const NavigationContext = createContext("POP");

export const NavigationReader = memo(() => {
  const navigationType = useContext(NavigationContext);
  const [observedNavigation, setObservedNavigation] = useState("unobserved");
  const onReadNavigation = useEffectEvent(() => setObservedNavigation(navigationType));

  useEffect(() => {
    window.addEventListener("read-navigation", onReadNavigation);
    return () => window.removeEventListener("read-navigation", onReadNavigation);
  }, []);

  return <p>{observedNavigation}</p>;
});
