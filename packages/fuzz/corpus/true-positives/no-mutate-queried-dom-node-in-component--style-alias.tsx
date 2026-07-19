// rule: no-mutate-queried-dom-node-in-component
// weakness: alias-guard
// source: deep audit of millionco/react-doctor#1000

export const Row = ({ opacity }: { opacity: number }) => {
  const row = document.getElementById("row");
  if (row) {
    const rowStyle = row.style;
    rowStyle.opacity = "0";
  }
  return <div id="row" style={{ opacity }} />;
};
