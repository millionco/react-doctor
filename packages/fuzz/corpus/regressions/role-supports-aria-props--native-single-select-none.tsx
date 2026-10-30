// rule: role-supports-aria-props
// verdict: pass
// weakness: literal-native-host
// source: Invented curated single-select autocomplete-none control

export const DeliveryChoice = () => (
  <select aria-label="Delivery choice" multiple={false} size={1} aria-autocomplete="none">
    <option value="harbor">Harbor</option>
    <option value="meadow">Meadow</option>
  </select>
);
