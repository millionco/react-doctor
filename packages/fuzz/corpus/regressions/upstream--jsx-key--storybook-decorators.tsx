// rule: react/jsx-key
// weakness: library-idiom
// source: oxc-project/oxc#1982 (storybook decorators array is not a render list)
import type { ComponentType, ReactNode } from "react";

declare const useMyStore: () => object;
const Provider = (props: { store: object; children?: ReactNode }) => <div>{props.children}</div>;

export const MyStory = () => <div>story</div>;

MyStory.decorators = [
  (Component: ComponentType) => (
    <div style={{ margin: "3em" }}>
      <Component />
    </div>
  ),
  (Component: ComponentType) => {
    const store = useMyStore();
    return (
      <Provider store={store}>
        <Component />
      </Provider>
    );
  },
];
