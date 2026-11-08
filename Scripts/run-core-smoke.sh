#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
CORE="$ROOT/app/src/main/java/com/rideoffercopilot/android"
kotlinc "$CORE/Models.kt" "$CORE/DecisionEngine.kt" "$CORE/OfferParser.kt" \
 "$CORE/LiveOfferGate.kt" "$CORE/LiveOfferDedup.kt" \
 "$CORE/UniversalOfferDetector.kt" "$CORE/VerdictBadgeStyle.kt" \
 "$ROOT/Scripts/CoreSmoke.kt" "$ROOT/Scripts/UniversalSmoke.kt" \
 -include-runtime -d "$TMP/core-smoke.jar"
java -cp "$TMP/core-smoke.jar" com.rideoffercopilot.android.CoreSmokeKt "$ROOT"
java -cp "$TMP/core-smoke.jar" com.rideoffercopilot.android.UniversalSmokeKt "$ROOT"
