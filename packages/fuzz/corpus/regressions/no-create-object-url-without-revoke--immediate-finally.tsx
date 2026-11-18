// rule: no-create-object-url-without-revoke
// weakness: control-flow
// source: synthetic audit regression
export const inspectPreview = (
  blob: Blob,
  anchor: HTMLAnchorElement,
  skip: boolean,
  inspect: (url: string) => boolean,
) => {
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    if (skip) return false;
    return inspect(anchor.href);
  } finally {
    URL.revokeObjectURL(url);
  }
};
