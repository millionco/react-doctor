// rule: window-open-without-noopener
// weakness: parameter-write
interface LinkProps {
  href: string;
}

export const MutatedLink = ({ href }: LinkProps) => {
  href = `https://example.com/${href}`;
  return <button onClick={() => window.open(href)}>Open</button>;
};
