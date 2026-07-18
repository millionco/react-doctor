// rule: no-blocked-paste
// source: PR #1337 fuzz verdict-drop

export const PasswordFields = () => (
  <>
    <input type="password" onPaste={(event) => (event as any).preventDefault()} />
    <input
      type="password"
      onPaste={(event) => {
        return event!.preventDefault();
      }}
    />
  </>
);
