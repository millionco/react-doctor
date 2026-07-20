// rule: no-img-without-dimensions
// weakness: cross-file
// source: PR #1337 all-rules parity (027xiguapi/pear-rec)
export const ScreenshotBackground = () => (
  <div className="screenshots-background">
    <img className="screenshots-background-image" src="/background.png" alt="" />
  </div>
);
