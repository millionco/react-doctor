// rule: no-mixed-icon-libraries
// weakness: library-idiom
// source: 0.8.1-to-main all-rules parity (weijunext/nextjs-starter, revokslab/ShipFree)
// verdict: pass
import { GithubIcon } from "lucide-react";
import { SiDiscord } from "react-icons/si";

export const SocialLinks = () => (
  <>
    <GithubIcon />
    <SiDiscord />
  </>
);
