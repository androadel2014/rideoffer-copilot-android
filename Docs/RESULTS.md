# RideOffer Copilot Android v2.1.0 — SOURCE / TEST RESULTS

## Status

**SOURCE DELIVERED — NOT AN APK BUILD CLAIM.** This environment has `kotlinc` and Java but **no Android SDK, Gradle distribution, Android emulator, or Samsung device**. The source-only Kotlin tests and structural audit below were executed successfully. Android/Compose compilation with AGP, JUnit through Gradle, ML Kit on live frames, projection startup, usage access, real overlay, and a debug APK have **NOT** been tested. They are required CI + phone acceptance gates.

## Scope implemented

1. **Generalized offer recognition:** `UniversalOfferDetector.kt` requires a plausible non-hourly fare plus at least **two of three** independent signals: distance in mi/km, duration in hours/minutes, pickup/dropoff label or address. Nearby lines are gathered around fare anchors to reduce mixing maps with offers. Map/checkout/receipt pages without an explicit offer cue are excluded. This is a heuristic with possible false positives/negatives. Original `OfferParser.scan` is **first choice for Uber/Lyft**, and existing sample parsing/engine totals are retained. Synthetic text fixtures for DoorDash, Instacart, Amazon Flex, Walmart Spark, and an unknown courier demonstrate the new paths, **not live-platform compatibility certification**.
2. **Delivery offers with missing metrics:** if distance + duration both present, use **unchanged** `DecisionEngine` with the same NET cost, 75-mile empty return, dead-zone penalty, and unchanged green/red floors. Missing pickup prevents green. If either route distance or time is absent, **separate** `PartialDeliveryGrader` returns a conservative stored YELLOW/BORDERLINE (ungradable for NET), with `$X/delivery` and optionally **gross** `$X/hr est.` (fare ÷ displayed minutes, before unknown operating cost). `metricMode`, `hasTripMiles`, `hasTripMinutes`, and `grossHourlyEstimate` are optional additive JSON fields; *missing* numeric trip/net fields are serialized as **JSON null**, not invented zero; CSV has blank cells for them. Existing columns keep their order; `metric_mode,gross_hourly_estimate` are appended. In-memory zero placeholders are behind known/unknown flags and are **never displayed or transmitted as NET**.
3. **Package-based live app label:** `SourceAppResolver.kt` uses **optional special Usage Access** (`PACKAGE_USAGE_STATS`, `UsageStatsManager.queryEvents`, foreground ACTIVITY_RESUMED) and package-to-name mapping. Generic installed app label is used when Android permits. **Without Usage Access** or a reliable foreground package event, the saved live label is **`Unknown app`**. MediaProjection **does not provide package identity**; claiming otherwise would be false. Manual imported images identify familiar brands through text, not package identity. No Accessibility service or UI scraping is used. Usage events and raw package names are neither saved nor synced.
4. **Live watch retained:** same MediaProjection, consent each session, Android foreground service, 2s sampling, OLED/battery-aware screen-off pause, ML Kit bundled OCR, dedup, notification Stop, overlay fallback, optional TTS, auto history, and manual share/import. v2.1 now OCRs the **full captured frame** instead of only the bottom 66% and locates fare-centered card neighborhoods. No screenshots are saved. It does **not** run when capture is revoked or the OS blocks protected content.
5. **Badge mapping fixed:** tested `VerdictBadgeStyle.forVerdict()` returns **GREEN #167840 ACCEPT**, **AMBER #C28A11 BORDERLINE**, **RED #AC2334 SKIP**. `LiveOverlay`, notification and service voice map from the stored `verdict` using this function, including YELLOW (never red SKIP).
6. **Privacy:** local-only persisted fields and `rawText` remain allow-list filtered via `CardPrivacy.sanitize`; strengthened for free-form names after labels (e.g., `Pick up Josh`, `UberX Sarah`) plus original standalone and grouped rating-name patterns. No raw image saved; only sanitized card transcript enters SQLite. **Limit:** a string that convincingly resembles a street address can include a person's name and is not reliably distinguishable by regex alone. Review exports before optional sync; absolute zero name leakage cannot be certified without device tests/a stronger data-classification mechanism.
7. **Sync unchanged in control flow:** still OFF by default, no sync code in capture service, network path gated in main app. Same endpoint/header/keys, HTTP success rules and per-row queue semantics. `app_version` now `2.1.0`. For incomplete delivery the contract's trip/net metrics are explicit null; an older server that rejects these values will leave data queued. No data is marked synced unless it confirms the batch. ML Kit SDK telemetry is separate from app-owned sync and cannot be ruled out.

## Files / regression boundaries

- `app/build.gradle.kts`: **versionName=2.1.0**, **versionCode=3**, applicationId unchanged `com.rideoffercopilot.android`.
- `app/src/main/AndroidManifest.xml`: added optional `PACKAGE_USAGE_STATS` and package query visibility for installed launchable apps. Preserved `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `SYSTEM_ALERT_WINDOW`, `POST_NOTIFICATIONS`, `INTERNET` and prior service/intent declarations. **No Accessibility** declaration.
- **Unmodified from the v2.0.0 ZIP:** `DecisionEngine.kt`, `DriverPrefs.kt`, `LiveOfferDedup.kt`, `SyncService` *transport/control flow*, `Zones.json`, 9 original Domain JUnit tests, 5 v2 LiveWatch JUnit tests, and all Gradle dependency/version pins (except app version). `SyncService.kt` only updates version and serializes optional missing numeric values as null.
- **No database schema version change:** existing SQLite `offers`/`waits` persist; additive JSON keys decode with defaults for old records.
- **Gradle wrapper JAR still NOT bundled** (inherited exception). `gradlew`/`.bat` bootstrap the official Gradle 8.13 wrapper JAR and verify SHA-256 on first execution, so Gradle network access is necessary. No modified signing configuration.

## Actually executed here

| Check | Result | Scope |
|---|---|---|
| `python3 Scripts/check_source.py` | **PASS** | Pinned stack, version, manifest, consent/service, no Accessibility, generic detection, optional usage access, sync OFF gating, fixture inventory, hash constraints |
| `Scripts/run-core-smoke.sh` | **PASS** | Kotlin JVM compile and legacy assertions + `UniversalSmoke` (platform fixtures, missing data, km, source-name precedence, badge mapping, dedup and sanitizer) |
| Uber calibrated transcript | **PASS** | GREEN, NET **$3.3185/mi**, **$74.04/hr** |
| Lyft calibrated transcript | **PASS** | RED, NET **$0.7662/mi**, **$39.34/hr**; 464.7 effective miles / 543 min |
| DoorDash + Instacart synthesized transcripts | **PASS** | Fare, distance, duration, partial pickup/address extraction; complete trip pathway |
| Amazon Flex synthesized transcript | **PASS** | Fare $92 / 180 min / no miles → YELLOW, **$30.67/hr gross estimate**, **not NET** |
| Walmart Spark synthesized transcript | **PASS** | Fare $22.70 / 7.4 mi / no duration → YELLOW, **$22.70/delivery**, dead-zone warning, no hourly estimate |
| Unknown courier fixture | **PASS** | Generic price/leg and conversion 4.2 km → 2.6098 miles; Unknown app if no package |
| Badge mapping pure Kotlin | **PASS** | Green/amber/red have distinct exact labels and integer colors; YELLOW = BORDERLINE |
| Prior JUnit cases | **PRESENT, not run by Gradle** | 9 Domain + 5 LiveWatch tests preserved; 12 GenericOffer JUnit tests added |
| Actual Gradle APK / Samsung live capture | **NOT TESTED** | No Android SDK/Gradle/device in this environment; no APK provided |

**Acceptance gates for Kiko on CI and Galaxy S25 Ultra:**

1. Run `./gradlew :app:testDebugUnitTest :app:assembleDebug --stacktrace`, report all JUnit results and actual APK path. Test install over v2.0.0 with the SAME applicationId to verify existing History/settings persist.
2. Confirm system consent **Entire screen**, starts typed foreground service; overlay permission optional, notification fallback, Stop action, on-stop cleanup, Android 14–16 behavior, screen rotation and screen off/lock.
3. Show genuine offer cards from Uber, Lyft, DoorDash, Instacart, Amazon Flex and Walmart Spark **while parked**. Inspect OCR candidates and compare with actual amounts; account for different cards by city/app version and protected content. **Not proven by synthetic text fixtures.**
4. Turn off Usage Access → verify `Unknown app` in live History; grant special access in Android Settings → verify names reflect actual foreground package, not OCR guesses. Switch between two work apps; verify event lag behavior.
5. Verify GREEN/AMBER/RED overlays, matching notification and TTS labels, and incomplete delivery rate labels; verify none show fake NET metrics. Test all three colors directly from a test harness (do not wait for marketplace offers).
6. Confirm stored/transferred `rawText` and addresses remove names in observed cards. Privacy is rules-based; do not enable sync until satisfied with sample output. Verify app-owned **zero networking when sync OFF**, then 200 accepted/401 retry, and server behavior on `null` incomplete-delivery numeric fields.
7. Measure real detection delay, battery consumption/heat, multiple duplicate frames, and false-positive rate from shopping carts, maps, receipts, hourly-rate widgets, and offer layouts. Read-only aid: it never taps Accept, rejects offers, or controls any work app.

