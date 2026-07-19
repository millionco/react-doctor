// rule: no-mutate-queried-dom-node-in-component
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const Controller = () => {
  document.getElementById("row").style.opacity = "0";
  return <div />;
};

export const Row = ({ opacity }) => <div id="row" style={{ opacity }} />;
