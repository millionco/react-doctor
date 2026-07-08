// rule: nextjs-no-a-element
// weakness: library-idiom
// source: FP-FIX history (download / new tab / protocol-relative are not client navigations)
export default function Links() {
  return (
    <>
      <a href="/files/report.pdf" download>
        PDF
      </a>
      <a href="/external" target="_blank">
        New tab
      </a>
      <a href="//cdn.example.com/asset">CDN</a>
    </>
  );
}
