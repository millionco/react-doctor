export const App = () => (
  <form>
    <input name="title" defaultValue="Draft" />
    <textarea name="notes" defaultValue="Ready" />
    <select name="region" defaultValue="north">
      <option value="north">North</option>
      <option value="south">South</option>
    </select>
  </form>
);
