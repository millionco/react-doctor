// pass: no-prop-callback-in-render
import { build } from "adapter";
export const Panel = ({ data }) => {
  const { prepare } = build(data);
  prepare(data);
  return <div />;
};
