import type { Framework } from "../types/index.js";

export const getPublicEnvPrefix = (framework: Framework): string | null => {
  switch (framework) {
    case "nextjs":
      return "NEXT_PUBLIC_*";
    case "vite":
    case "tanstack-start":
      return "VITE_*";
    case "cra":
      return "REACT_APP_*";
    case "gatsby":
      return "GATSBY_*";
    default:
      return null;
  }
};
