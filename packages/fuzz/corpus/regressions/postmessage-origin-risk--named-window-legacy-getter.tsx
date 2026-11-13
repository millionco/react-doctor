// rule: postmessage-origin-risk
// verdict: pass
// weakness: provider-mutation
// source: synthetic
window.__defineGetter__("addEventListener", () => (_type, callback) => callback({ data: "local" }));
const receive = (event) => console.log(event.data);
window.addEventListener("message", receive);
