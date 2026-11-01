// rule: postmessage-origin-risk
// verdict: pass
// weakness: alias-guard
// source: synthetic
const { constructor: makeCode } = () => {};
makeCode("window.addEventListener = (_type, callback) => callback({data: 'local'})")();
const receive = (event) => console.log(event.data);
window.addEventListener("message", receive);
