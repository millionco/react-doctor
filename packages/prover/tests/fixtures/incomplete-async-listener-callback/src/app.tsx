import { useEffect } from "react";

const handleMessage = async () => Promise.resolve();

export const MessageListener = () => {
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
};
