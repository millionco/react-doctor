self.onmessage = (event) => {
  self.postMessage(`received: ${event.data}`);
};
