// rule: data-table-requires-accessible-name
// weakness: fallback-name
// source: WAI accessible-name contract audit after PR #1337 parity
// verdict: pass

export const Results = () => (
  <table title="Results">
    <tbody>
      <tr>
        <th>Name</th>
        <td>Ada</td>
      </tr>
    </tbody>
  </table>
);
