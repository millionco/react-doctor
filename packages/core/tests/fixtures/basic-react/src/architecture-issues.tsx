import { useState } from "react";

const GenericHandlerComponent = () => {
  const handleClick = () => {};
  return <button onClick={handleClick}>Click</button>;
};

const RenderInRenderComponent = () => {
  const renderItem = (item: string) => {
    const [isExpanded] = useState(false);
    return <span>{isExpanded ? item : item.slice(0, 1)}</span>;
  };
  return <div>{renderItem("hello")}</div>;
};

const ParentComponent = () => {
  const NestedChild = () => <span>nested</span>;
  return <NestedChild />;
};

export { GenericHandlerComponent, RenderInRenderComponent, ParentComponent };
