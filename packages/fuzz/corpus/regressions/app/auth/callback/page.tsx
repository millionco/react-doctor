// rule: nextjs-no-client-side-redirect
// weakness: framework-gating
// source: React Bench write-react-bulwarkmail-webmail__3NU2E6d / PR #1285

import { useEffect } from "react";
import { toRouterPath } from "@/lib/browser-navigation";

export const AuthCallback = () => {
  useEffect(() => {
    let pairReauthResume = false;
    try {
      pairReauthResume = sessionStorage.getItem("pair_reauth_resume") === "1";
    } catch {}
    if (pairReauthResume && state) {
      (async () => {
        const response = await completePairing(state);
        if (!response.ok) return;
        router.push(toRouterPath("/settings"));
      })();
    }

    const codeVerifier = sessionStorage.getItem("oauth_code_verifier");
    loginWithOAuth(codeVerifier).then((success) => {
      if (success) router.push("/inbox");
    });

    loginWithServerSso(code, state).then((success) => {
      if (success) {
        let redirectTo = "/";
        try {
          const saved = sessionStorage.getItem("redirect_after_login");
          if (saved) {
            sessionStorage.removeItem("redirect_after_login");
            redirectTo = saved;
          }
        } catch {}
        router.push(toRouterPath(redirectTo));
      }
    });
  }, []);

  return null;
};
