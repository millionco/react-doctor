// rule: jsx-no-target-blank
// weakness: dynamic-computed
// source: 0.8.1 parity hardening
// verdict: fail
interface ExternalLinkProps {
  destination: string;
}

export const ExternalLink = ({ destination }: ExternalLinkProps) => (
  <a href={destination} target="_blank">
    Open
  </a>
);
