; AutoPrint Installer Configuration Script
; Compiles the PyInstaller 'dist\AutoPrint' directory into a single AutoPrintSetup.exe.

[Setup]
AppName=AutoPrint
AppVersion=1.0.0
AppPublisher=AutoPrint
DefaultDirName={localappdata}\Programs\AutoPrint
DefaultGroupName=AutoPrint
OutputDir=dist
OutputBaseFilename=AutoPrintSetup
Compression=lzma
SolidCompression=yes
; 'lowest' privileges bypasses Windows UAC dialog prompts completely
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
; Automatically closes running instances of our executables to prevent file lock errors
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Copy all files compiled in the distribution directory
Source: "dist\AutoPrint\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
; Pre-create folders required by the agent
Name: "{app}\temp"
Name: "{app}\logs"

[Icons]
; Run the launcher when starting AutoPrint from the Start Menu
Name: "{userprograms}\AutoPrint"; Filename: "{app}\Launcher.exe"; IconFilename: "{app}\_internal\assets\icon.ico"; IconIndex: 0
; Create a settings shortcut on the Desktop pointing to the Setup Wizard
Name: "{userdesktop}\AutoPrint Configuration"; Filename: "{app}\AutoPrintSetupWizard.exe"; IconFilename: "{app}\_internal\assets\icon.ico"; IconIndex: 0

[Registry]
; Register the launcher in the Current User Startup registry run keys for automatic boot on restart
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AutoPrintLauncher"; ValueData: """{app}\Launcher.exe"""; Flags: uninsdeletevalue

[UninstallDelete]
Type: filesandordirs; Name: "{app}\temp"
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{localappdata}\AutoPrint"

[Run]
; Whitelist the installation folder and configuration directory in Windows Defender (best-effort)
Filename: "powershell.exe"; Parameters: "-WindowStyle Hidden -Command ""Add-MpPreference -ExclusionPath '{app}'"""; Flags: runhidden; StatusMsg: "Configuring local security preferences..."
Filename: "powershell.exe"; Parameters: "-WindowStyle Hidden -Command ""Add-MpPreference -ExclusionPath '{localappdata}\AutoPrint'"""; Flags: runhidden; StatusMsg: "Configuring local security preferences..."

; Launch Launcher.exe detached and post-install, without blocking installer termination
Filename: "{app}\Launcher.exe"; Description: "Launch AutoPrint Agent"; Flags: postinstall nowait

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Gracefully request the running Agent to shut down prior to copying files
  if FileExists(ExpandConstant('{app}\Launcher.exe')) then
  begin
    Log('Found existing AutoPrint installation. Sending graceful shutdown signal...');
    Exec(ExpandConstant('{app}\Launcher.exe'), '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(2000); // Give the agent processes time to finish active spools and exit
  end;
  Result := '';
end;
