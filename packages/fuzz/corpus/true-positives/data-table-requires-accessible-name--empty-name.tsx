// rule: data-table-requires-accessible-name
// weakness: static-empty-value
// source: WAI accessible-name contract audit after PR #1337 parity
// verdict: fail

export const Results = () => (
  <table aria-label="">
    <tbody>
      <tr>
        <th>Name</th>
        <td>Ada</td>
      </tr>
    </tbody>
  </table>
);
