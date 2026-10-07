import { useEffect } from "react";
export const Clock = () => {
  useEffect(() => {
    const timer = setInterval(() => {}, 100);
    return () => clearTimeout(timer);
  }, []);
  return null;
};
