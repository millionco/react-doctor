// rule: no-img-without-dimensions
// weakness: wrapper-transparency
// source: independent synthetic conditional-parent regression
// verdict: pass

export const Picture = ({ showImage }: { showImage: boolean }) => (
  <section style={{ height: 96 }}>
    {showImage ? <img src="/sample.png" alt="Sample" /> : null}
  </section>
);
