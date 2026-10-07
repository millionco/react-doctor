// rule: form-control-requires-name
// weakness: static-disabled
// source: WHATWG form entry-list contract audit after PR #1337 parity
// verdict: pass

export const DisabledProfileFields = ({ fieldsetProps }: { fieldsetProps: object }) => (
  <form>
    <input disabled value="Ada" />
    <select disabled={true} value="en" />
    <fieldset disabled>
      <textarea value="Unavailable" />
    </fieldset>
    <fieldset {...fieldsetProps}>
      <input value="Potentially unavailable" />
    </fieldset>
  </form>
);
