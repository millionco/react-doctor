Implement `avatarInitials` in `src/avatar-initials.ts`.

## Expected behavior

`avatarInitials(fullName)` returns up to two uppercase initials for an avatar:

- Split the name on whitespace, ignoring empty segments (so extra spaces are
  fine).
- With two or more words: take the first letter of the **first** and **last**
  word.
- With one word: take just its first letter.
- With no words (empty/whitespace-only): return `""`.
- Always uppercase the result.

Examples:

- `avatarInitials("Ada Lovelace")` → `"AL"`
- `avatarInitials("grace hopper")` → `"GH"`
- `avatarInitials("Cher")` → `"C"`
- `avatarInitials("  Margaret  Heafield  Hamilton ")` → `"MH"`
- `avatarInitials("")` → `""`

## Constraints

Keep the exported `avatarInitials(fullName: string): string` signature. Do not
change `src/avatar.tsx`.
