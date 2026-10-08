param(
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$BuildTools,
    [Parameter(Mandatory=$true)][string]$AndroidJar,
    [string]$AndroidClasses,
    [Parameter(Mandatory=$true)][string]$KeyStore,
    [string]$KeyAlias = 'kry-android',
    [string]$StorePassword = $env:KRY_STORE_PASSWORD,
    [string]$Output = (Join-Path $PSScriptRoot '..\ZJU-English-KRY-Android-v1.1.2.apk'),
    [string]$BuildDirectory = (Join-Path $PSScriptRoot '..\..\work\apk-build')
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = $JavaHome
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $Program ($LASTEXITCODE)" }
}
if (!$StorePassword) { throw 'Set KRY_STORE_PASSWORD before building.' }
$build = [IO.Path]::GetFullPath($BuildDirectory)
New-Item -ItemType Directory -Force $build, "$build\classes", "$build\dex" | Out-Null
Invoke-Checked "$BuildTools\aapt2.exe" @('compile', '--dir', "$PSScriptRoot\res", '-o', "$build\resources.zip")
Invoke-Checked "$BuildTools\aapt2.exe" @('link', '-o', "$build\base.apk", '--manifest', "$PSScriptRoot\AndroidManifest.xml", '-I', $AndroidJar, '-A', "$PSScriptRoot\assets", "$build\resources.zip", '--min-sdk-version', '26', '--target-sdk-version', '35')
$sourceFiles = @(Get-ChildItem "$PSScriptRoot\src" -Filter '*.java' -Recurse | ForEach-Object FullName)
$compileClasspath = if ($AndroidClasses) { $AndroidClasses } else { $AndroidJar }
Invoke-Checked "$JavaHome\bin\javac.exe" (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options', '-classpath', $compileClasspath, '-d', "$build\classes") + $sourceFiles)
$classFiles = @(Get-ChildItem "$build\classes" -Filter '*.class' -Recurse | ForEach-Object FullName)
Invoke-Checked "$JavaHome\bin\java.exe" (@('-cp', "$BuildTools\lib\d8.jar", 'com.android.tools.r8.D8', '--lib', $AndroidJar, '--min-api', '26', '--output', "$build\dex") + $classFiles)
Copy-Item -LiteralPath "$build\base.apk" -Destination "$build\unsigned.apk" -Force
Push-Location "$build\dex"
try { Invoke-Checked "$JavaHome\bin\jar.exe" @('uf', "$build\unsigned.apk", 'classes.dex') } finally { Pop-Location }
Invoke-Checked "$BuildTools\zipalign.exe" @('-f', '-p', '4', "$build\unsigned.apk", "$build\aligned.apk")
Invoke-Checked "$JavaHome\bin\java.exe" @('-jar', "$BuildTools\lib\apksigner.jar", 'sign', '--ks', $KeyStore, '--ks-key-alias', $KeyAlias, '--ks-pass', "pass:$StorePassword", '--key-pass', "pass:$StorePassword", '--out', $Output, "$build\aligned.apk")
Invoke-Checked "$JavaHome\bin\java.exe" @('-jar', "$BuildTools\lib\apksigner.jar", 'verify', '--verbose', '--print-certs', $Output)
Get-FileHash -LiteralPath $Output -Algorithm SHA256
