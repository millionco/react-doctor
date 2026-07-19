// rule: no-placeholder-only-field
// weakness: cross-file
// source: RDE OSS corpus, formbricks/formbricks packages/survey-ui

interface ElementHeaderProps {
  readonly headline: string;
  readonly htmlFor: string;
}

const ElementHeader = ({ headline, htmlFor }: ElementHeaderProps) => (
  <label htmlFor={htmlFor}>{headline}</label>
);

export const Profile = () => (
  <>
    <ElementHeader headline="Username" htmlFor="username" />
    <input id="username" placeholder="Enter username" />
  </>
);
