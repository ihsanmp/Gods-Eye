' God's Eye View — silent entry point.
'
' Shortcuts point here rather than straight at PowerShell so no console window
' ever flashes on screen. WScript.Shell.Run with intWindowStyle 0 starts the
' launcher fully hidden; bWaitOnReturn False lets this wrapper exit immediately
' while the launcher stays alive to own the server's lifetime.

Option Explicit

Dim shell, fso, scriptDir, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & _
          scriptDir & "\gev-launcher.ps1"""

shell.Run command, 0, False
