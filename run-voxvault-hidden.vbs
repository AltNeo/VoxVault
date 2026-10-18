Option Explicit

Dim fileSystemObject
Dim shell
Dim processEnvironment
Dim repoRoot
Dim appDir
Dim electronExe
Dim rendererEntry
Dim mainEntry
Dim logDir
Dim logFilePath
Dim missingPaths
Dim launchCommand
Dim launchErrorNumber
Dim launchErrorDescription
Dim folderErrorNumber
Dim folderErrorDescription

Set fileSystemObject = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repoRoot = fileSystemObject.GetParentFolderName(WScript.ScriptFullName)
appDir = fileSystemObject.BuildPath(repoRoot, "frontend")
electronExe = fileSystemObject.BuildPath(appDir, "node_modules\electron\dist\electron.exe")
rendererEntry = fileSystemObject.BuildPath(appDir, "dist\index.html")
mainEntry = fileSystemObject.BuildPath(appDir, "dist-electron\main.js")
logDir = fileSystemObject.BuildPath(repoRoot, ".runtime")
logFilePath = fileSystemObject.BuildPath(logDir, "launcher.log")

If Not fileSystemObject.FolderExists(logDir) Then
    On Error Resume Next
    fileSystemObject.CreateFolder logDir
    folderErrorNumber = Err.Number
    folderErrorDescription = Err.Description
    Err.Clear
    On Error GoTo 0

    If folderErrorNumber <> 0 Then
        MsgBox "VoxVault launcher could not create the log folder:" & vbCrLf & logDir & vbCrLf & vbCrLf & _
            "Error " & folderErrorNumber & ": " & folderErrorDescription, vbCritical, "VoxVault launcher"
        WScript.Quit 1
    End If
End If

missingPaths = ""
If Not fileSystemObject.FileExists(electronExe) Then
    AppendLog logFilePath, "Preflight failed: missing electron executable: " & electronExe
    missingPaths = missingPaths & vbCrLf & electronExe
End If
If Not fileSystemObject.FileExists(rendererEntry) Then
    AppendLog logFilePath, "Preflight failed: missing renderer entry: " & rendererEntry
    missingPaths = missingPaths & vbCrLf & rendererEntry
End If
If Not fileSystemObject.FileExists(mainEntry) Then
    AppendLog logFilePath, "Preflight failed: missing main entry: " & mainEntry
    missingPaths = missingPaths & vbCrLf & mainEntry
End If

If Len(missingPaths) > 0 Then
    MsgBox "VoxVault cannot start because these required paths are missing:" & missingPaths & vbCrLf & vbCrLf & _
        "Run npm run build in frontend, then try again.", vbExclamation, "VoxVault launcher"
    WScript.Quit 1
End If

Set processEnvironment = shell.Environment("PROCESS")
processEnvironment("VOXVAULT_START_HIDDEN") = "1"
processEnvironment("VITE_DEV_SERVER_URL") = ""
shell.CurrentDirectory = appDir

launchCommand = """" & electronExe & """ ."

On Error Resume Next
shell.Run launchCommand, 0, False
launchErrorNumber = Err.Number
launchErrorDescription = Err.Description
Err.Clear
On Error GoTo 0

If launchErrorNumber <> 0 Then
    AppendLog logFilePath, "Launch failed: " & launchCommand & "; error " & launchErrorNumber & ": " & launchErrorDescription
    MsgBox "VoxVault could not be launched. See .runtime\launcher.log for details.", vbCritical, "VoxVault launcher"
    WScript.Quit 1
End If

AppendLog logFilePath, "Launch succeeded: " & launchCommand & "; working directory: " & appDir
WScript.Quit 0

Sub AppendLog(logPath, logMessage)
    Dim logFile

    On Error Resume Next
    Set logFile = fileSystemObject.OpenTextFile(logPath, 8, True)
    If Err.Number = 0 Then
        logFile.WriteLine FormatTimestamp(Now) & " " & logMessage
        logFile.Close
    End If
    Err.Clear
    On Error GoTo 0
End Sub

Function FormatTimestamp(timestamp)
    FormatTimestamp = Year(timestamp) & "-" & _
        Right("0" & Month(timestamp), 2) & "-" & _
        Right("0" & Day(timestamp), 2) & " " & _
        Right("0" & Hour(timestamp), 2) & ":" & _
        Right("0" & Minute(timestamp), 2) & ":" & _
        Right("0" & Second(timestamp), 2)
End Function
