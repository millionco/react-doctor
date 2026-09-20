// rule: display-name
// verdict: pass
// weakness: nested-jsx-data
// source: makeplane/plane@4225bc59de784f8991a8c30de77ca8b2b3fd8cc7, command-items-list.tsx:59
// Minimized from confirmed candidate 341142ca56252569cc998629b2ee29bb98d6da32229b014c9dce43db537859ec.

export const makeSections = (title: string) => (query: string) => {
  const sections = [{ items: [{ title, icon: <Icon /> }] }];
  const filtered = sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.title.includes(query)),
  }));
  return filtered.filter((section) => section.items.length > 0);
};

export const makeDescriptor = () => () => ({ icon: <Icon /> });
export const makeDescriptors = () => () => [{ icon: <Icon /> }];
