// rule: a11y/noInteractiveElementToNoninteractiveRole
// weakness: name-heuristic
// source: biomejs/biome#2862 (autonomous custom element with noninteractive role)
export const renderCustomElementWithRole = () => {
  return <x-element role="group" />;
};
