$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$jdk21 = "C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
if (-not (Test-Path "$jdk21/bin/java.exe")) {
  $jdk21 = Join-Path $PSScriptRoot 'tooling/jdk-21.0.13+9'
}
if (Test-Path "$jdk21/bin/java.exe") {
  $env:JAVA_HOME = $jdk21
  $env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$env:GRADLE_USER_HOME = Join-Path $PSScriptRoot 'tooling/gradle-cache'
if (-not (Test-Path "$env:JAVA_HOME/bin/java.exe")) { throw 'Set JAVA_HOME to Java 21.' }
Push-Location $repo
try {
  npm run build:frontend
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  npm --prefix react-frontend run cap -- sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
  Set-Content react-frontend/android/local.properties ('sdk.dir=' + $env:ANDROID_HOME.Replace('\','/'))
  Push-Location react-frontend/android
  try { ./gradlew.bat --no-daemon assembleRelease; if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' } }
  finally { Pop-Location }
  node mobile/sign.cjs --native
  if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
} finally { Pop-Location }

