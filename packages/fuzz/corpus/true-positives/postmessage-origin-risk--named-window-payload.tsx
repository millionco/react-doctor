// rule: postmessage-origin-risk
// verdict: fail
// weakness: cross-function
// source: synthetic
const receive = (event) => console.log(event.data);
window.addEventListener("message", receive);
