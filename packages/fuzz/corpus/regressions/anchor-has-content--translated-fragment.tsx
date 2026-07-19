// rule: anchor-has-content
// weakness: wrapper-transparency
// source: RDE OSS corpus, calcom/cal.com packages/emails

interface AccountLinkProps {
  readonly translate: (key: string) => string;
}

export const AccountLink = ({ translate }: AccountLinkProps) => (
  <a href="/account">
    <>{translate("account")}</>
  </a>
);
