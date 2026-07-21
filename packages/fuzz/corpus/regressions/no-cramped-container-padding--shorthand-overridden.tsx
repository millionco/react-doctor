// rule: no-cramped-container-padding
// weakness: last-property-wins
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const RoomyStatus = () => (
  <div
    style={{
      backgroundColor: "navy",
      padding: 4,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
    }}
  >
    Status
  </div>
);
