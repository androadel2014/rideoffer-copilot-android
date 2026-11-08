#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
kotlinc "$ROOT/app/src/main/java/com/rideoffercopilot/android/Models.kt" \
 "$ROOT/app/src/main/java/com/rideoffercopilot/android/DecisionEngine.kt" \
 "$ROOT/app/src/main/java/com/rideoffercopilot/android/OfferParser.kt" \
 "$ROOT/app/src/main/java/com/rideoffercopilot/android/LiveOfferGate.kt" \
 "$ROOT/app/src/main/java/com/rideoffercopilot/android/LiveOfferDedup.kt" \
 "$ROOT/Scripts/CoreSmoke.kt" -include-runtime -d "$TMP/core-smoke.jar"
java -jar "$TMP/core-smoke.jar" "$ROOT"
