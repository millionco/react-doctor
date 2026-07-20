// rule: react-router-no-static-cookie-expires
// weakness: static-value-semantics
// source: adversarial contract audit of PR #1411
import { createCookie } from "react-router";

export const campaignCookie = createCookie("campaign", {
  expires: new Date("2030-01-01T00:00:00Z"),
});
