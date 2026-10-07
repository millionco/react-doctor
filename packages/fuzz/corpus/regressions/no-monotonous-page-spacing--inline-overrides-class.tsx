// rule: no-monotonous-page-spacing
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Page = () => (
  <main>
    <div className="p-4" style={{ padding: 1 }}>
      Panel 1
    </div>
    <div className="p-4" style={{ padding: 2 }}>
      Panel 2
    </div>
    <div className="p-4" style={{ padding: 3 }}>
      Panel 3
    </div>
    <div className="p-4" style={{ padding: 4 }}>
      Panel 4
    </div>
    <div className="p-4" style={{ padding: 5 }}>
      Panel 5
    </div>
    <div className="p-4" style={{ padding: 6 }}>
      Panel 6
    </div>
    <div className="p-4">Panel 7</div>
    <div className="p-4">Panel 8</div>
    <div className="p-4">Panel 9</div>
    <div className="p-4">Panel 10</div>
    <div className="p-4">Panel 11</div>
    <div className="p-4">Panel 12</div>
  </main>
);
