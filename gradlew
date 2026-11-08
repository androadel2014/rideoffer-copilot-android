#!/bin/sh
# Secure bootstrap for the official Gradle 8.13 wrapper JAR (see README limitation).
set -eu
APP_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
JAR="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
EXPECT=81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f
check() {
  if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$JAR" | awk '{print $1}');
  else got=$(shasum -a 256 "$JAR" | awk '{print $1}'); fi
  [ "$got" = "$EXPECT" ]
}
if [ ! -f "$JAR" ] || ! check; then
  command -v curl >/dev/null 2>&1 || { echo 'curl required to bootstrap the official wrapper JAR.' >&2; exit 1; }
  tmp="$JAR.download"
  trap 'rm -f "$tmp"' EXIT
  curl -fLSs --retry 2 -o "$tmp" 'https://services.gradle.org/distributions/gradle-8.13-wrapper.jar'
  mv "$tmp" "$JAR"
  check || { rm -f "$JAR"; echo 'Gradle wrapper JAR checksum mismatch; refusing to run.' >&2; exit 1; }
fi
if [ -n "${JAVA_HOME:-}" ]; then JAVA="$JAVA_HOME/bin/java"; else JAVA=java; fi
exec "$JAVA" -Dorg.gradle.appname=gradlew -classpath "$JAR" org.gradle.wrapper.GradleWrapperMain "$@"
