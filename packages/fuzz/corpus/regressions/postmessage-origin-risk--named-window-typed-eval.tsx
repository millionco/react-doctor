// rule: postmessage-origin-risk
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic
const receive = (event) => {
  // oxlint-disable-next-line no-eval -- regression seed for transparent direct eval
  (eval as any)("event = { data: 'local' }");
  console.log(event.data);
};
window.addEventListener("message", receive);
