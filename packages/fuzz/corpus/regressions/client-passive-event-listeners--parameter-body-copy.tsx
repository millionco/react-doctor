// rule: client-passive-event-listeners
// weakness: copy-tracking
// verdict: pass
// source: synthetic parameter-body environment regression
const replaceListener = (receiver, ignored = 0) => {
  var receiver;
  receiver.addEventListener = customListener;
};
const target = new EventTarget();

replaceListener(target);
target.addEventListener("wheel", () => track());
