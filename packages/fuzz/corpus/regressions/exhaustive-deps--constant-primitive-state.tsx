// rule: exhaustive-deps
// weakness: effect-semantics
// source: react-bench internxt/drive-web oracle validation
import { useEffect, useState } from "react";

export const MobilePlatform = () => {
  const [platform, setPlatform] = useState("");
  useEffect(() => {
    if (navigator.userAgent.includes("iPhone")) setPlatform("iphone");
    if (navigator.userAgent.includes("Android")) setPlatform("android");
  });
  return <output>{platform}</output>;
};
