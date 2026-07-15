// rule: iframe-has-title
// weakness: control-flow
// source: React Bench Open Design hidden live-artifact thumbnail
export const LiveArtifactThumbnail = () => (
  <div aria-hidden className="design-card-thumb">
    <iframe src="/preview" title="" tabIndex={-1} />
  </div>
);
