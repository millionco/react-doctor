// rule: window-open-without-noopener
// weakness: override-order
export const UnsafeLink = ({ dynamicHref }: { dynamicHref: string }) => {
  const links = { docs: "/safe", docs: dynamicHref };
  return (
    <a
      href="/safe"
      href={dynamicHref}
      onClick={(event) => {
        window.open(event.currentTarget.href);
        window.open(links.docs);
      }}
    />
  );
};
