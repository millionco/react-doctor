// rule: jsx-no-target-blank
// weakness: control-flow
// source: adversarial parity review
// verdict: pass
export const ExternalLink = ({ href, isExternal }) => (
  <a
    href={href}
    target={!isExternal ? undefined : "_blank"}
    rel={isExternal ? "noreferrer" : undefined}
  >
    External destination
  </a>
);
