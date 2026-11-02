// rule: no-sync-xhr
// weakness: copy-tracking
// verdict: pass
// source: synthetic parameter-body environment regression
const replaceOpen = (receiver, ignored = 0) => {
  var receiver;
  receiver.open = customOpen;
};
const request = new XMLHttpRequest();

replaceOpen(request);
request.open("GET", "/api", false);
