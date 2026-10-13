; Browsered installer for Windows (Inno Setup 6).
; Installs for the current user only: no administrator rights needed.
; Build: windows/build.sh, then iscc windows\browsered.iss

#define AppVersion GetEnv("BROWSERED_VERSION")
#if AppVersion == ""
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{6F0B8C3E-5B7A-4C0E-9C55-2D7E3A1B9F42}
AppName=Browsered
AppVersion={#AppVersion}
AppVerName=Browsered {#AppVersion}
AppPublisher=FemtoEmacs
AppPublisherURL=https://github.com/FemtoEmacs/browsered
AppSupportURL=https://github.com/FemtoEmacs/browsered/issues
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Browsered
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
OutputDir=dist
OutputBaseFilename=Browsered-Setup-{#AppVersion}
SetupIconFile=browsered.ico
UninstallDisplayIcon={app}\browsered.exe
UninstallDisplayName=Browsered
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[CustomMessages]
english.StartAtSignIn=Start the Browsered helper when I sign in
brazilianportuguese.StartAtSignIn=Iniciar o assistente do Browsered ao entrar no Windows
english.QuitBrowsered=Quit Browsered
brazilianportuguese.QuitBrowsered=Encerrar o Browsered
english.OpenBrowsered=Open Browsered
brazilianportuguese.OpenBrowsered=Abrir o Browsered
english.InitFile=Browsered init file
brazilianportuguese.InitFile=Arquivo init do Browsered

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "{cm:StartAtSignIn}"; Flags: unchecked

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: ignoreversion
; The user's init file: created once, kept on upgrade and uninstall.
Source: "stage\init.scm"; DestDir: "{userappdata}\Browsered"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{userprograms}\Browsered"; Filename: "{app}\browsered.exe"
Name: "{userprograms}\{cm:QuitBrowsered}"; Filename: "{app}\browsered.exe"; Parameters: "--quit"
Name: "{userprograms}\{cm:InitFile}"; Filename: "{sys}\notepad.exe"; Parameters: """{userappdata}\Browsered\init.scm"""
Name: "{userdesktop}\Browsered"; Filename: "{app}\browsered.exe"; Tasks: desktopicon
Name: "{userstartup}\Browsered"; Filename: "{app}\browsered.exe"; Parameters: "--serve"; Tasks: startup

[Run]
Filename: "{app}\browsered.exe"; Description: "{cm:OpenBrowsered}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\browsered.exe"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "QuitHelper"

[Code]
{ An upgrade replaces browsered.exe: stop a running helper first. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Helper: String;
begin
  Helper := ExpandConstant('{app}\browsered.exe');
  if FileExists(Helper) then
    Exec(Helper, '--quit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
