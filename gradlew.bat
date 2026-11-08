@echo off
setlocal EnableExtensions
set "APP_HOME=%~dp0"
set "WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar"
set "WRAPPER_URL=https://services.gradle.org/distributions/gradle-8.13-wrapper.jar"
set "EXPECTED=81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f"
if not exist "%WRAPPER_JAR%" goto DownloadWrapper
for /f "delims=" %%H in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%WRAPPER_JAR%').Hash.ToLowerInvariant()"') do set "ACTUAL=%%H"
if /I "%ACTUAL%"=="%EXPECTED%" goto RunGradle
:DownloadWrapper
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%WRAPPER_URL%' -OutFile '%WRAPPER_JAR%' -UseBasicParsing; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath '%WRAPPER_JAR%').Hash.ToLowerInvariant(); if($actual -ne '%EXPECTED%'){Remove-Item -LiteralPath '%WRAPPER_JAR%' -Force; throw 'Gradle 8.13 official wrapper checksum mismatch'}"
if errorlevel 1 exit /b 1
:RunGradle
if defined JAVA_HOME (
 set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
 set "JAVA_EXE=java.exe"
)
"%JAVA_EXE%" -Dorg.gradle.appname=gradlew -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
