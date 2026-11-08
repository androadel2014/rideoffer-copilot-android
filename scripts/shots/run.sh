#!/usr/bin/env bash
# v2.0.0 emulator smoke capture for RideOffer Copilot (Live Watch).
# Runs on the CI host with adb connected to a booted emulator.
# Captures the REAL app UI via screencap — nothing is staged or fabricated.
# Scope: install the CI-built debug APK, open Home (which carries the live
# watch permissions explanation), tap "Start live watch" to surface the
# system MediaProjection consent dialog (captured, then CANCELLED — no real
# capture session is approved), then History and Settings.
set -x
PKG="com.rideoffercopilot.android"
OUT="screenshots"
mkdir -p "$OUT"
DIAG="$OUT/diagnostics.txt"
: > "$DIAG"

snap() { adb exec-out screencap -p > "$OUT/$1"; }

dump_ui() {
  adb shell uiautomator dump /sdcard/dump.xml >/dev/null 2>&1 || true
  adb pull /sdcard/dump.xml /tmp/dump.xml >/dev/null 2>&1 || true
}

tap_text() {
  # $1 = text, $2 = exact|contains (default contains)
  dump_ui
  local coords
  coords=$(python3 scripts/shots/tap_text.py /tmp/dump.xml "$1" "${2:-contains}") || return 1
  adb shell input tap $coords
}

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode" >> "$DIAG" || true
adb shell am force-stop "$PKG" || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 5

# Home: live-watch explanation + Start live watch
snap 01-home.png
dump_ui; cp /tmp/dump.xml "$OUT/debug-home.xml" || true

# Scroll Home to reveal Recent feed + manual import section, then back up
adb shell input swipe 540 1600 540 600 300; sleep 1
snap 01b-home-scrolled.png
adb shell input swipe 540 600 540 1600 300; sleep 1

# Start live watch -> a system dialog is expected (notification permission
# prompt on API 33+, and/or the MediaProjection consent dialog). Capture
# whatever genuinely appears, save its UI dump, then cancel with Back.
if tap_text "Start live watch" contains; then
  sleep 3
  snap 02-live-consent.png
  dump_ui; cp /tmp/dump.xml "$OUT/debug-consent.xml" || true
  adb shell input keyevent 4; sleep 1
  # If a second stacked dialog was behind the first, capture + cancel it too.
  snap 02b-live-consent-2.png
  dump_ui; cp /tmp/dump.xml "$OUT/debug-consent-2.xml" || true
  adb shell input keyevent 4; sleep 1
fi
snap 02c-after-consent-cancel.png

# History tab
tap_text "History" exact || tap_text "History" contains
sleep 2
snap 03-history.png

# Settings tab
tap_text "Settings" exact || tap_text "Settings" contains
sleep 2
snap 04-settings.png

echo "smoke capture done" >> "$DIAG"
ls -l "$OUT" >> "$DIAG" || true
