// rule: no-mutate-queried-dom-node-in-component
// weakness: name-heuristic
// source: deep audit of millionco/react-doctor#1000

export const Row = ({ document, opacity }) => {
  document.getElementById("row").style.opacity = "0";
  return <div id="row" style={{ opacity }} />;
};
