#!/usr/bin/env bash
# v2.0.0 emulator END-TO-END live-watch proof for RideOffer Copilot.
# Real captures only — nothing staged in the app itself. Method (the
# builder's own suggested smoke): grant the overlay + notification
# permissions via adb, start live watch and APPROVE the system
# MediaProjection consent for "Entire screen", then display the app's own
# shipped Uber sample card (Docs/fixtures/) full-screen in the gallery.
# The running service should OCR it, grade it with the v1 engine, show the
# floating ACCEPT badge (~4.6s), and auto-log it to History. We screencap
# in a loop to catch the badge, then capture Home feed + History as the
# durable evidence.
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
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode" >> "$DIAG" || true

# Pre-grant what a user would grant in Settings (overlay badge + notifications)
adb shell appops set --uid "$PKG" SYSTEM_ALERT_WINDOW allow || true
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb shell appops get "$PKG" SYSTEM_ALERT_WINDOW >> "$DIAG" || true

# Push the shipped Uber fixture and register it with MediaStore
adb push Docs/fixtures/sample-uber-vienna-to-arlington.jpg /sdcard/Pictures/uber-fixture.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/uber-fixture.jpg >/dev/null 2>&1 || true
sleep 2
MEDIA_ID=$(adb shell content query --uri content://media/external/images/media --projection _id:_display_name 2>/dev/null | grep "uber-fixture" | grep -o "_id=[0-9]*" | head -1 | cut -d= -f2)
echo "fixture media id: $MEDIA_ID" >> "$DIAG"

# Launch app, start live watch
adb shell am force-stop "$PKG" || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 5
snap 01-home.png

tap_text "Start live watch" contains
sleep 3
dump_ui; cp /tmp/dump.xml "$OUT/debug-consent.xml" || true
# If the share-scope spinner is on "A single app", switch to "Entire screen"
if grep -q "A single app" /tmp/dump.xml; then
  tap_text "A single app" contains || true
  sleep 2
  tap_text "Entire screen" contains || true
  sleep 2
fi
tap_text "Start now" contains
sleep 3
snap 02-after-consent.png
adb shell dumpsys activity services "$PKG" >> "$DIAG" || true

# Show the Uber offer card full-screen
adb shell am start -a android.intent.action.VIEW -t image/jpeg -d "content://media/external/images/media/$MEDIA_ID" -f 1
sleep 5
# Hide gallery chrome with one center tap
adb shell input tap 540 1000 || true
sleep 1

# Capture loop: badge lives ~5s once; detection may wait on ML Kit's
# first-run model download, so watch for up to ~90 seconds.
for i in $(seq -w 1 30); do
  snap "frame-$i.png"
  sleep 2
done

# Back to the app: Home recent feed + History are the durable proof
adb shell am start -n "$PKG/.MainActivity"
sleep 3
snap 10-home-after.png
tap_text "History" exact || tap_text "History" contains
sleep 2
snap 11-history-after.png
dump_ui; cp /tmp/dump.xml "$OUT/debug-history.xml" || true

echo "e2e capture done" >> "$DIAG"
ls -l "$OUT" >> "$DIAG" || true
