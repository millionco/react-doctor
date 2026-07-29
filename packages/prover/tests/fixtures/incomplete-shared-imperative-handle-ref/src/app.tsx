import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

interface ItemHandle {
  select(): void;
}

interface ItemProperties {
  ref?: Ref<ItemHandle>;
}

const Item = ({ ref }: ItemProperties) => {
  useImperativeHandle(ref, () => ({
    select: () => undefined,
  }));
  return <li>item</li>;
};

export const Application = () => {
  const itemRef = useRef<ItemHandle | null>(null);
  return (
    <ul>
      <Item ref={itemRef} />
      <Item ref={itemRef} />
    </ul>
  );
};
