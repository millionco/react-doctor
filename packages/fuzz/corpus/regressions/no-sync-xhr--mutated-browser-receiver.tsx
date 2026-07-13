// rule: no-sync-xhr
// weakness: receiver-provenance
// source: ISSUES_TO_FIX_ASAP.md Web API receiver adversarial review
const request = new XMLHttpRequest();
const replaceOpen = (receiver: XMLHttpRequest) => {
  receiver.open = customOpen;
};

replaceOpen(request);
request.open("GET", "/api", false);
