#!/usr/bin/env bash
# One-off Play Store screenshot capture for RideOffer Copilot.
# Runs on the CI host with adb connected to a booted emulator.
# Captures the REAL app UI via screencap — nothing is staged or fabricated.
# The two graded verdicts come from feeding the app its own shipped sample
# offer cards (Docs/fixtures/) through its real ACTION_SEND import path,
# exactly as a user sharing a screenshot into the app would.
set -x
PKG="com.rideoffercopilot.android"
OUT="screenshots"
mkdir -p "$OUT"

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

snap() { adb exec-out screencap -p > "$OUT/$1"; }

media_id() {
  # $1 = display name of a pushed image; prints its MediaStore _id (or nothing)
  adb shell content query --uri content://media/external/images/media \
    --projection _id:_display_name 2>/dev/null \
    | grep "$1" | grep -o "_id=[0-9]*" | head -1 | cut -d= -f2
}

send_offer() {
  # $1 = MediaStore id; delivers the image to the app via its share-intent path
  adb shell am start -n "$PKG/.MainActivity" \
    -a android.intent.action.SEND -t image/jpeg \
    --eu android.intent.extra.STREAM "content://media/external/images/media/$1" \
    -f 1
}

adb wait-for-device
# Portrait phone resolution for Play screenshots.
adb shell wm size 1080x1920 || true
sleep 2

adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm clear "$PKG" || true

# `am` cannot attach a ClipData grant to EXTRA_STREAM, so the -f 1 flag alone
# leaves the app with "no access to content://..." (observed in run 2).
# Pre-grant the media permission instead; the flag stays as a bonus.
adb shell pm grant "$PKG" android.permission.READ_MEDIA_IMAGES || true

# Stage the app's own sample offer cards and register them with MediaStore.
adb push Docs/fixtures/sample-uber-vienna-to-arlington.jpg /sdcard/Pictures/uber-offer.jpg
adb push Docs/fixtures/sample-lyft-dc-to-nyc-REDACTED.jpg /sdcard/Pictures/lyft-offer.jpg
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/uber-offer.jpg || true
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/lyft-offer.jpg || true
sleep 3
# Fallback registration if the scan broadcast did not index the files.
if [ -z "$(media_id uber-offer.jpg)" ]; then
  adb shell content insert --uri content://media/external/images/media \
    --bind _data:s:/sdcard/Pictures/uber-offer.jpg --bind title:s:uber-offer || true
fi
if [ -z "$(media_id lyft-offer.jpg)" ]; then
  adb shell content insert --uri content://media/external/images/media \
    --bind _data:s:/sdcard/Pictures/lyft-offer.jpg --bind title:s:lyft-offer || true
fi
sleep 2

# 1) Home / Copilot screen — the app's default screen.
adb shell am start -n "$PKG/.MainActivity"
sleep 8
snap 01-home.png

# 2) Uber sample card -> verdict screen (GREEN "ACCEPT" expected).
UBER_ID=$(media_id uber-offer.jpg)
echo "Uber media id: ${UBER_ID:-NONE}"
if [ -n "$UBER_ID" ]; then
  send_offer "$UBER_ID"
  sleep 14
fi
snap 02-verdict-uber.png

# Mark accepted -> lands on History with the logged offer. If the import
# failed instead, the error screen's button returns to Home.
if ! tap_text "Mark accepted" contains; then
  tap_text "Try another image" contains || true
fi
sleep 3

# 3) History screen (real logged offer after step 2; empty state otherwise).
tap_text "History" exact || true
sleep 3
snap 03-history.png

# 4) Lyft sample card -> verdict screen (RED "DECLINE / LONG TRIP" expected).
tap_text "Home" exact || true
sleep 2
LYFT_ID=$(media_id lyft-offer.jpg)
echo "Lyft media id: ${LYFT_ID:-NONE}"
if [ -n "$LYFT_ID" ]; then
  send_offer "$LYFT_ID"
  sleep 14
fi
snap 04-verdict-lyft.png

# 5) Settings screen.
if ! tap_text "Mark declined" contains; then
  tap_text "Try another image" contains || true
fi
sleep 3
tap_text "Settings" exact || true
sleep 3
snap 05-settings.png

dump_ui
cp /tmp/dump.xml "$OUT/debug-final-dump.xml" || true
ls -la "$OUT"
