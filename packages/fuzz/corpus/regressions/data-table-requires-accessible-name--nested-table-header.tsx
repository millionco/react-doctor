// rule: data-table-requires-accessible-name
// weakness: nested-ownership
// source: nested table contract audit after PR #1337 parity
// verdict: pass

export const Results = () => (
  <table>
    <tbody>
      <tr>
        <td>
          <table aria-label="Results">
            <tbody>
              <tr>
                <th>Name</th>
                <td>Ada</td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>
);
