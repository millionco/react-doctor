// rule: react/prop-types
// weakness: name-heuristic
// source: jsx-eslint/eslint-plugin-react#3696 (inner-component prop shares name with local map variable)
import { useEffect } from "react";
import type { FunctionComponent } from "react";

type Widget = { id: number };
type MainComponentProps = { dummy: string };
type SubComponentProps = { widget: Widget };

export const MainComponent: FunctionComponent<MainComponentProps> = ({ dummy }) => {
  const widgets: Widget[] = [];
  useEffect(() => {});
  void dummy;

  const SubComponent: FunctionComponent<SubComponentProps> = ({ widget }) => {
    return <>{widget.id}</>;
  };
  void SubComponent;

  return (
    <>
      {widgets.map((widget, jIdx) => (
        <span key={jIdx}>{widget.id}</span>
      ))}
    </>
  );
};
