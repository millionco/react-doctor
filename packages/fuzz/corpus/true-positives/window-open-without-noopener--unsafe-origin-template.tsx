// rule: window-open-without-noopener
// weakness: origin-boundary
export const openUnsafeOriginTemplate = () => {
  window.open(`${window.origin}.evil.com`);
};

export const openSlashJoinedTemplate = () => {
  const prefix = "/";
  window.open(`${prefix}/evil.com`);
};
