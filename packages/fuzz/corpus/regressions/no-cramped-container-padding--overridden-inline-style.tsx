// rule: no-cramped-container-padding
// weakness: last-property-wins
// source: Bugbot review on PR #850
// oxlint-disable no-dupe-keys -- regression seed for ordered overrides

export const RoomyStatus = () => (
  <span style={{ backgroundColor: "navy", padding: 4, padding: 16 }}>Status</span>
);
