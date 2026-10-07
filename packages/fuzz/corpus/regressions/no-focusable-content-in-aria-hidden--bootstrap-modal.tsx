// rule: no-focusable-content-in-aria-hidden
// weakness: library-idiom
// source: 0.8.1-to-main all-rules parity (Bootstrap modal markup)
// verdict: pass

export const BootstrapModal = () => (
  <div className="modal fade" aria-hidden="true">
    <button type="button" data-bs-dismiss="modal">
      Close
    </button>
    <input aria-label="Name" />
  </div>
);
