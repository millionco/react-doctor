export const ForwardingChildren = ({ children }) => children;

export const RetainingChildren = ({ children, retain }) => {
  retain(children);
  return null;
};
