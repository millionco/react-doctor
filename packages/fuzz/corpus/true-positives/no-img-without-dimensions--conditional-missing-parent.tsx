// rule: no-img-without-dimensions
// weakness: wrapper-transparency
// source: independent synthetic conditional-parent regression
// verdict: fail

export const Picture = ({ showImage }: { showImage: boolean }) => (
  <section>{showImage ? <img src="/sample.png" alt="Sample" /> : null}</section>
);
