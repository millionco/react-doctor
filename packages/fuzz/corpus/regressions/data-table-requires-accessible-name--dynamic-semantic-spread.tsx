// rule: data-table-requires-accessible-name
// weakness: dynamic-computed
// source: final adversarial parity review
// verdict: pass

export const Results = ({ tableProperties }) => (
  <table {...tableProperties}>
    <tbody>
      <tr>
        <th>Name</th>
        <td>Ada</td>
      </tr>
    </tbody>
  </table>
);
