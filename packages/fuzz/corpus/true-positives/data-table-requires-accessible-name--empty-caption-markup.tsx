// rule: data-table-requires-accessible-name
// weakness: empty-descendant-markup
// source: accessibility parity review
// verdict: fail

export const Results = () => (
  <table>
    <caption>
      <span hidden>Results</span>
      <img alt={null} src="/results.svg" />
    </caption>
    <tbody>
      <tr>
        <th>Name</th>
      </tr>
    </tbody>
  </table>
);
