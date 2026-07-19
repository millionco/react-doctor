// rule: window-open-without-noopener
// weakness: mutation
export const openMutatedConfig = (userControlledUrl: string) => {
  const links = [{ href: "/safe" }];
  links[0].href = userControlledUrl;
  links.forEach((item) => window.open(item.href));

  const extendedLinks = [{ href: "/safe" }];
  extendedLinks.push({ href: userControlledUrl });
  extendedLinks.forEach((item) => window.open(item.href));

  const destructuredLinks = [{ href: "/safe" }];
  const destructuredLinksAlias = destructuredLinks;
  destructuredLinksAlias[0].href = userControlledUrl;
  destructuredLinks.forEach(({ href }) => window.open(href));
};
