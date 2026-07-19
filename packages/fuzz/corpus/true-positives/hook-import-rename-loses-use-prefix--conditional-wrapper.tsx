// rule: hook-import-rename-loses-use-prefix
// weakness: control-flow
// source: PR #1000 deep audit

import { useNavigate as routerUseNavigate } from "react-router-dom";

export const useNavigate = (disabled: boolean) => {
  if (disabled) return null;
  return routerUseNavigate();
};
