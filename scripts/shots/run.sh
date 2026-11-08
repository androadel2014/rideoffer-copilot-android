#!/usr/bin/env bash
# v2.0.0 emulator END-TO-END live-watch proof — attempt 2.
# Attempt 1 (run 42481329497) failed environmentally: the CI emulator's
# System UI ANR'd ("System UI isn't responding") before the consent dialog
# could render, so no session ever started. This attempt adds ANR recovery
# (tap "Wait") at every step and verifies the session is actually ACTIVE
# (button flips to "Stop live watch") before showing the fixture card.
# Method unchanged: pre-grant overlay + notifications, approve the system
# MediaProjection consent ("Entire screen"), display the shipped Uber
# fixture full-screen; the service should OCR → grade → badge → auto-log.
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

dismiss_anr() {
  dump_ui
  if grep -q "System UI isn" /tmp/dump.xml; then
    echo "ANR dialog present; tapping Wait" >> "$DIAG"
    tap_text "Wait" exact || true
    sleep 3
  fi
}

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode" >> "$DIAG" || true
adb shell appops set --uid "$PKG" SYSTEM_ALERT_WINDOW allow || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true

adb push Docs/fixtures/sample-uber-vienna-to-arlington.jpg /sdcard/Pictures/uber-fixture.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/uber-fixture.jpg >/dev/null 2>&1 || true
sleep 2
MEDIA_ID=$(adb shell content query --uri content://media/external/images/media --projection _id:_display_name 2>/dev/null | grep "uber-fixture" | grep -o "_id=[0-9]*" | head -1 | cut -d= -f2)
echo "fixture media id: $MEDIA_ID" >> "$DIAG"

adb shell am force-stop "$PKG" || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 6
dismiss_anr
snap 01-home.png

tap_text "Start live watch" contains
sleep 3
dismiss_anr
dump_ui; cp /tmp/dump.xml "$OUT/debug-consent.xml" || true
if grep -q "A single app" /tmp/dump.xml; then
  tap_text "A single app" contains || true
  sleep 2
  tap_text "Entire screen" contains || true
  sleep 2
fi
tap_text "Start now" contains || true
sleep 3
dismiss_anr

# Verify the session is genuinely active before showing the card
ACTIVE="no"
for i in 1 2 3 4 5 6; do
  dump_ui
  if grep -q "Stop live watch" /tmp/dump.xml; then ACTIVE="yes"; break; fi
  sleep 4
done
echo "live session active: $ACTIVE" >> "$DIAG"
adb shell dumpsys activity services "$PKG" 2>/dev/null | grep -A2 "LiveWatchService" >> "$DIAG" || true
snap 02-after-consent.png

if [ "$ACTIVE" = "yes" ]; then
  adb shell am start -a android.intent.action.VIEW -t image/jpeg -d "content://media/external/images/media/$MEDIA_ID" -f 1
  sleep 6
  dismiss_anr
  adb shell input tap 540 1000 || true
  sleep 1
  for i in $(seq -w 1 30); do
    snap "frame-$i.png"
    sleep 2
    if [ "$i" = "10" ] || [ "$i" = "20" ]; then dismiss_anr; fi
  done
fi

dismiss_anr
adb shell am start -n "$PKG/.MainActivity"
sleep 3
dismiss_anr
snap 10-home-after.png
tap_text "History" exact || tap_text "History" contains
sleep 2
snap 11-history-after.png
dump_ui; cp /tmp/dump.xml "$OUT/debug-history.xml" || true

echo "e2e attempt 2 done" >> "$DIAG"
ls -l "$OUT" >> "$DIAG" || true
