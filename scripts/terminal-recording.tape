Output artifacts/react-doctor-terminal.gif
Output artifacts/react-doctor-terminal.mp4

Set Shell "bash"
Set Width 1200
Set Height 480
Set FontSize 18
Set TypingSpeed 35ms
Set Framerate 30
Set CursorBlink false
Set Theme "Catppuccin Mocha"

Hide
Type "source scripts/setup-terminal-recording.sh"
Enter
Wait+Screen /terminal-recording-ready/
Type "clear"
Enter
Sleep 500ms
Show

Type "react-doctor --no-lint --no-dead-code --no-supply-chain --no-score"
Enter
Wait+Screen /Select projects/
Sleep 500ms
Space
Enter
Wait+Screen /Scanning.../
Sleep 2s
Wait+Screen /No issues found!/
Sleep 2s

Hide
Type "use-terminal-recording-tui-fixture"
Enter
Show

Type "clear && react-doctor experimental-tui --no-score --no-supply-chain --project app-a"
Enter
Wait+Screen /add CI/
Sleep 2s
Enter
Wait+Screen /Copy prompt/
Sleep 2s
Escape
Wait+Screen /add CI/
Down
Sleep 1s
Type "G"
Sleep 2s
Type "q"
