// rule: dangerous-html-sink
// weakness: wrapper-transparency
// source: native parity audit of multiline template declaration taint
// verdict: fail

export const Preview = (props) => {
  const markup = `<section>
${props.html}
</section>`;
  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
};
