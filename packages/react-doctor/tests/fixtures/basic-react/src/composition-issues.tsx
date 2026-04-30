import { useState, useEffect } from "react";

// no-render-prop-children: 3+ render-prop slots on the same element is
// the proliferation smell. A single render-prop (renderInput, renderItem)
// is fine — those are common library APIs.
const Modal = ({
  renderHeader,
  renderFooter,
  renderActions,
  children,
}: {
  renderHeader?: () => JSX.Element;
  renderFooter?: () => JSX.Element;
  renderActions?: () => JSX.Element;
  children?: React.ReactNode;
}) => (
  <div>
    {renderHeader?.()}
    <div>{children}</div>
    {renderActions?.()}
    {renderFooter?.()}
  </div>
);

export const RenderPropMisuse = () => (
  <Modal
    renderHeader={() => <h1>Title</h1>}
    renderFooter={() => <p>Footer</p>}
    renderActions={() => <button>OK</button>}
  />
);

// no-polymorphic-children: switching on `typeof children`.
export const PolyButton = ({ children }: { children: React.ReactNode }) =>
  typeof children === "string" ? <button>{children}</button> : <button>{children}</button>;

// rendering-svg-precision: 6 decimals in the path data.
export const HighPrecisionIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M 10.293847 20.847362 L 30.938472 40.192837 z" fill="currentColor" />
  </svg>
);

// rerender-memo-before-early-return: useMemo returning JSX, then early
// return for loading/skeleton.
import { useMemo } from "react";

export const ProfileCard = ({
  user,
  loading,
}: {
  user: { name: string; id: string };
  loading: boolean;
}) => {
  const avatar = useMemo(() => <img alt={user.name} src={`/u/${user.id}`} />, [user]);
  if (loading) return <div>Loading…</div>;
  return <div>{avatar}</div>;
};

// no-prop-callback-in-effect: child syncs state to parent via callback
// in useEffect.
export const ChildSyncer = ({ onInputChange }: { onInputChange: (next: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    onInputChange(text);
  }, [text, onInputChange]);
  return <input value={text} onChange={(e) => setText(e.target.value)} />;
};
