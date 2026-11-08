#!/usr/bin/env bash
# v2.0.0 live-start DIAGNOSTIC run. Attempts 1-2 did not produce an active
# session: attempt 1 hit a System UI ANR before the dialog; attempt 2 got
# the real consent dialog but ended on the launcher with no active session.
# This run's only job: find out WHY — capture logcat (AndroidRuntime /
# rideoffercopilot), process liveness, and the service record immediately
# after the consent approval, then proceed to the fixture ONLY if active.
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
  dump_ui
  local coords
  coords=$(python3 scripts/shots/tap_text.py /tmp/dump.xml "$1" "${2:-contains}") || return 1
  adb shell input tap $coords
}

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set --uid "$PKG" SYSTEM_ALERT_WINDOW allow || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb logcat -c || true

adb shell am force-stop "$PKG" || true
adb shell am start -n "$PKG/.MainActivity"
sleep 5
snap 01-home.png

tap_text "Start live watch" contains
sleep 3
dump_ui; cp /tmp/dump.xml "$OUT/debug-consent.xml" || true
grep -o 'text="[^"]*"' /tmp/dump.xml | sort -u >> "$DIAG" || true
tap_text "Start now" contains || true
sleep 5

echo "--- post-consent diagnostics ---" >> "$DIAG"
echo "pidof: $(adb shell pidof $PKG)" >> "$DIAG"
adb shell dumpsys activity services "$PKG" 2>/dev/null | grep -E "LiveWatchService|ServiceRecord" | head -5 >> "$DIAG" || true
adb shell dumpsys activity activities 2>/dev/null | grep -E "topResumedActivity|ResumedActivity" | head -3 >> "$DIAG" || true
adb logcat -d 2>/dev/null | grep -E "AndroidRuntime|FATAL EXCEPTION|rideoffercopilot|MediaProjection|ForegroundService" | head -60 > "$OUT/logcat-key.txt" || true
snap 02-after-consent.png
dump_ui; cp /tmp/dump.xml "$OUT/debug-after.xml" || true

ACTIVE="no"
if grep -q "Stop live watch" /tmp/dump.xml; then ACTIVE="yes"; fi
echo "live session active: $ACTIVE" >> "$DIAG"

if [ "$ACTIVE" = "yes" ]; then
  adb push Docs/fixtures/sample-uber-vienna-to-arlington.jpg /sdcard/Pictures/uber-fixture.jpg
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/uber-fixture.jpg >/dev/null 2>&1 || true
  sleep 2
  MEDIA_ID=$(adb shell content query --uri content://media/external/images/media --projection _id:_display_name 2>/dev/null | grep "uber-fixture" | grep -o "_id=[0-9]*" | head -1 | cut -d= -f2)
  echo "fixture media id: $MEDIA_ID" >> "$DIAG"
  adb shell am start -a android.intent.action.VIEW -t image/jpeg -d "content://media/external/images/media/$MEDIA_ID" -f 1
  sleep 6
  adb shell input tap 540 1000 || true
  sleep 1
  for i in $(seq -w 1 30); do
    snap "frame-$i.png"
    sleep 2
  done
  adb shell am start -n "$PKG/.MainActivity"
  sleep 3
  snap 10-home-after.png
  tap_text "History" exact || tap_text "History" contains
  sleep 2
  snap 11-history-after.png
  dump_ui; cp /tmp/dump.xml "$OUT/debug-history.xml" || true
fi

echo "diagnostic run done" >> "$DIAG"
ls -l "$OUT" >> "$DIAG" || true
