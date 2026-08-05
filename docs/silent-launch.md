# Silent launch

`run-voxvault-hidden.vbs` starts the prebuilt VoxVault Electron app without a console window. It is launched by `wscript.exe` rather than `powershell.exe` because Windows Script Host does not allocate a console, so there is no console flash. The launcher starts Electron hidden, sets tray-only startup, clears the dev-server URL, and records activity in `.runtime\launcher.log`.

## Prerequisite

Build the frontend before using this launch path. It serves the prebuilt renderer and Electron main process, so it otherwise starts stale or missing code.

```powershell
cd frontend && npm run build
```

## Repoint the scheduled task

Run this PowerShell command as an operator to update the existing `VoxVault` task. Do not run it from the launcher script.

```powershell
Set-ScheduledTask -TaskName 'VoxVault' -Action (New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"C:\Mods\VoxVault\run-voxvault-hidden.vbs"')
```

## Verify

- No console window appears.
- No taskbar button appears.
- A VoxVault tray icon appears.
- `.runtime\launcher.log` contains a new timestamped line.

## Revert

Restore the old PowerShell dev-stack action with:

```powershell
Set-ScheduledTask -TaskName 'VoxVault' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '"C:\Mods\VoxVault\run-electron-managed.ps1"')
```

## Troubleshooting

Check `.runtime\launcher.log` for missing build paths, launch errors, and successful launch entries. Re-run `cd frontend && npm run build` if the prebuilt output is missing or stale.
