Output artifacts/react-doctor-terminal.gif
Output artifacts/react-doctor-terminal.mp4

Set Shell "bash"
Set Width 1000
Set Height 600
Set FontSize 18
Set TypingSpeed 35ms
Set Framerate 30
Set CursorBlink false
Set Theme "Catppuccin Mocha"

Hide
Type "source scripts/setup-terminal-recording.sh"
Enter
Show

Type "react-doctor --no-lint --no-dead-code --no-score"
Enter
Wait+Screen /Select projects/
Sleep 500ms
Space
Enter
Wait+Screen /Scanning.../
Sleep 2s
Wait+Screen /No issues found!/
Sleep 2s
