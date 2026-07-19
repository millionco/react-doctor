// rule: no-mutate-queried-dom-node-in-component
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (iframe loader: the mutated element renders no style prop, so React never diffs or reverts the write)
export const FrameWrapper = ({ componentName }: { componentName: string }) => {
  const onLoad = () => {
    document.getElementById("iframe-loader").style.display = "none";
  };
  return (
    <>
      <div id="iframe-loader">Loading ...</div>
      <iframe id="myFrame" title={componentName} onLoad={onLoad} src={componentName} />
    </>
  );
};
