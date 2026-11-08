# RideOffer Copilot Android — build / QA results

## Scope delivered

**Source project** (one activity, Compose Material 3), `ACTION_SEND image/*` and in-app picker, bundled ML Kit on-device recognizer, parser, iOS-equivalent decision engine, Android TTS, Verdict/Home/History/Settings, SQLite tables + detailed record JSON + CSV/JSON exports, optional HTTPS sync and secure driver key, iOS Zones.json, JUnit tests, Windows wrapper bootstrap and GitHub Actions source build workflow.

## What was actually run here

- PASS: `kotlinc` compiled `Models.kt`, `DecisionEngine.kt`, `OfferParser.kt` with the available Kotlin compiler **1.9.0** (this is a local core-only syntax check, not a build with requested Kotlin 2.3.10).
- PASS: `Scripts/run-core-smoke.sh` ran a JVM executable against **transcribed** fixtures and checked the math, parsing, address extraction, bonus inclusion, name redaction, zone boundaries and classification, long-trip threshold and missing pickup.
- PASS: `Scripts/check_source.py` checked gradle pinned source text, permission allow-list and data-driven zones against specified version/counts.
- **NOT TESTED**: `./gradlew`/Android Studio, Compose compilation, JUnit `:app:testDebugUnitTest`, ML Kit on the **actual sample JPEGs**, TTS on Samsung, Gallery share intent, picker, encrypted Keystore/SQLite migration, HTTP server or APK installation. No Android SDK/Gradle or external network was available in this environment.
- **KNOWN DELIVERY EXCEPTION:** Official `gradle-wrapper.jar` **not embedded**; bootstrap fetches the official distribution-service artifact, checks its SHA-256, and the binary Gradle distribution SHA-256 is separately pinned. Wrapper scripts bootstrap and verify the official 8.13 JAR on first use; see README. Do **not** describe this as a bundled official JAR.

## Calibration fixtures — passing pure Kotlin text tests

| Fixture | Parsed | Effective totals | NET | Verdict |
|---|---|---|---|---|
| UberX Vienna → Arlington | $41.87; pickup 2.6mi/9min; trip 9.3mi/23min; rider 4.97; +$18 INCLUDED | 11.9mi / 32min | **$3.31849/mi**, **$74.04375/hr** | **GREEN** |
| Lyft Comfort DC → NYC | $449 incl $50; pickup 0.7mi/5min; trip 232mi/269min; rider 4.8 | **464.7mi / 543min** (empty return) | **$0.76622/mi**, **$39.34/hr** | **RED** |

The attached screenshots are supplied as visual references only; **the ML Kit recognizer itself has not yet been run on them**. The second reference JPEG has a rider-name blackout. Text fixtures are in `app/src/test/resources`.

## Source invariants

- Green thresholds >= red thresholds, positive long trip, all numeric inputs finite and >=0; otherwise no save. Temporary defaults 1.25/30, 0.90/20, operating cost 0.20, long threshold 75, zone penalty +8mi/+25min.
- Fare from largest-height leading `$` line; excludes hourly estimated rate, never double-counts included dollar bonus.
- For legs, map hours→minutes and drop redundant summary, deduce pickup from earlier/shorter when unlabelled.
- Treat unlabelled/unknown pickup as incomplete and cap verdict at YELLOW.
- Word-boundary zone keyword, longest match, dead wins ties, neutral default.
- `rawText` allow-list redacted before local storage and again before transmission. Bare name-like street-suffix lines without address context are rejected. These heuristic checks still cannot guarantee no person name is ever preserved when embedded in a plausible address; do not enable sync until reviewed on device. Never persist image bytes.
- CSV header has exactly the 31 columns specified by the iOS source. Waits CSV header has five fields, with JSON arrays supported.
- Sync disabled by default; **app-owned sync networking** exits without requesting network. Google ML Kit itself may send SDK performance/usage metrics even with sync OFF, according to Google (https://developers.google.com/ml-kit/terms); its inputs and outputs remain on-device. Absolute app-wide zero networking therefore cannot be guaranteed with the mandated ML Kit SDK. `SyncService.syncNow()` exits **before URL/network setup** if disabled, and `RideController.syncOnOpen()` avoids calling it when disabled. HTTPS only. 200 with exactly expected `accepted` marks only unchanged sent documents, 401 or error preserves queued rows.
- Wait table/model is deliberately present without an automatic wait-creation UI, as permitted for Android trial.

## Kiko's on-device checklist

1. Build with JDK17/Android SDK36/Gradle8.13; run `:app:testDebugUnitTest :app:assembleDebug`. Confirm dependency pins and official wrapper SHA.
2. Install debug APK on Samsung Galaxy S25 Ultra; test Home → Gallery picker and Gallery → Share → RideOffer Copilot, no permission prompts for broad photo access.
3. Import both fixture pictures from `Docs/fixtures` and the original user captures; inspect exactly which ML Kit lines recognized, platform, fares, miles, time, location, bonus and rating. Confirm verdicts match table. Record OCR misses honestly. **Original pictures contain more UI background than OCR text fixtures**.
4. Try unrecognized image: error screen, zero new records. Try `Not an offer`: record removed. Try accepted and declined: history outcome updated.
5. Reopen app: history and settings persist. CSV/JSON exports have the exact schema; delete-all requires confirmation.
6. Set invalid thresholds/NaN/negative/blank driver ID; ensure blocked. Toggle voice off/on, test text-to-speech after import.
7. Keep sync OFF: confirm zero `HttpURLConnection` calls using a local interceptor/log. Then configure a **test** server, send 1+ offers, verify key header, JSON keys, explicit nulls, batch count, HTTP 200 acknowledgment and DB `synced_at`; simulate 401 and network failure, retain queue. No real rider personal names should enter raw OCR transcript. Check server handles wait deduplication (wait payload contract has no client_uuid).
8. Change driver ID while older unsynced records remain; verify grouped uploads maintain original stamped driver ID.
9. Confirm the default zones and manual dead-zone penalty/long return commute cases before trusting real-world judgments.

**Safety:** This is a decision aid, not a guaranteed fare estimate. Never interact with the screen while moving. OCR, bonus detection, and projected empty-return assumptions must be verified by the driver.
