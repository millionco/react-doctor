// rule: no-small-form-control-text
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity (ovexro/dockpanel)
// verdict: pass

export const DesktopServerPicker = () => <select className="hidden md:block text-xs" />;
