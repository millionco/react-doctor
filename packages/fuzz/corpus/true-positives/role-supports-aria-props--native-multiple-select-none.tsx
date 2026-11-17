// rule: role-supports-aria-props
// verdict: fail
// weakness: literal-native-host
// source: Invented native multiple-select autocomplete-none control

export const DeliveryChoice = () => (
  <select aria-label="Delivery choice" multiple aria-autocomplete="none">
    <option value="harbor">Harbor</option>
    <option value="meadow">Meadow</option>
  </select>
);
