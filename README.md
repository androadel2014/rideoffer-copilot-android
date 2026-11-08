# RideOffer Copilot Android v2.0.0 — LIVE WATCH (source project)

**Personal Samsung Galaxy S25 Ultra trial.** Kotlin + Jetpack Compose, English-only UI. No ads, accounts, analytics, Accessibility service, automatic tapping, or store publishing. Main experience: **start a consented LIVE screen-watch session**, switch to Uber/Lyft, automatically recognize offers and see a short verdict badge. Manual screenshot import from v1 remains available.

> **Build status: SOURCE ONLY.** This project was not assembled into an APK with Android Gradle Plugin in the authoring environment; there is no Android SDK or Gradle here. Pure Kotlin smoke tests and source checks were executed, but MediaProjection, ML Kit on actual frames, overlays, notifications, battery behavior, UI compilation and Samsung installation were **not** device-tested. CI/Android Studio must verify them. See `Docs/RESULTS.md`.

## Live workflow (on the phone)

1. Install the debug APK and launch **RideOffer Copilot**. The Home page explains the permissions and displays **Start live watch**.
2. Optional but recommended: tap **Allow floating badge**. Android opens **Display over other apps** settings; grant permission for RideOffer Copilot and go back. Without this, the app uses verdict notifications and Home's recent-offer feed.
3. Tap **Start live watch**. On Android 13+, allow notifications if prompted (needed for heads-up verdict notifications; denying does not block capture). Android then displays its official screen-capture consent dialog. **Select “Entire screen” (rather than a single app)** and approve. Android requires fresh consent for **every** new session.
4. Switch to Uber or Lyft, go online, and keep the screen on. The app's foreground service receives shared-screen frames, checks roughly every **2 seconds**, and runs **bundled on-device ML Kit OCR** on the bottom ~66% of the screen. OCR is reattempted periodically even if a coarse frame hash is unchanged.
5. When a likely offer card is readable (app cue + fare + a leg with both miles and minutes), it is parsed, graded on the original v1 NET rules, and **logged automatically** once per unique offer. A green **ACCEPT** or red **SKIP** badge shows NET $/mi and NET $/hr near the **TOP** for ~5 seconds and can be dismissed by tapping it. **YELLOW/BORDERLINE is displayed as SKIP** on this glanceable live badge; the recorded color/verdict remains yellow. With overlay permission denied, the app attempts a heads-up notification instead. Home shows the latest offer and recent feed.
6. Stop safely using **Stop** in the persistent foreground-service notification (or **Stop live watch** in Home). Stopping releases the projection, image buffers, recognizer, overlays, and TTS. A fresh permission prompt is needed to start again.
7. You can still choose **Grade a screenshot (manual)** or share an image from Samsung Gallery → Share → RideOffer Copilot. It uses the original v1 parser, Verdict, History, and Settings.

**Safety:** This is a read-only decision aid. It never accepts or rejects an Uber/Lyft ride for you and never touches their app. It can misread an offer, skip an offer, or show a late result; do not interact with the screen while driving. Verify important details when safely parked. The cost/threshold values are **PROVISIONAL**, not calibrated profitability advice.

## Permissions (AndroidManifest.xml)

| Permission | Purpose | Consent / consequence |
|---|---|---|
| `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PROJECTION` | Keep a visible, user-stoppable screen capture session alive | Android requires typed foreground service for Android 14+; **only launched following foreground user consent** |
| MediaProjection screen share | Receive screen frames; *no separate dangerous manifest permission* | **System prompt every session**; user must select **Entire screen** to follow Uber and Lyft across apps. Android system privacy indicator appears |
| `SYSTEM_ALERT_WINDOW` | Short, dismissible floating verdict badge | **Optional** special access, requested via Android's Settings screen; without it, notification + in-app feed fallback |
| `POST_NOTIFICATIONS` | Fallback offer alerts, plus visibility/control on supported versions | Runtime permission on Android 13+; denied notifications may prevent heads-up offer alerts; Home still has status and Stop |
| `INTERNET` | **Only** manually enabled HTTPS sync module | Sync OFF by default; service never executes the application's sync code |

**Not requested:** location, photo library/storage access, accessibility service, notification listener, microphone, boot-on-start, contacts, camera, or automated touch control. MediaProjection may be blocked by Android or another app's protected-content settings (`FLAG_SECURE`). On some Android versions/share dialogs the user may be offered a single-app share option; selecting only RideOffer Copilot will NOT watch Uber/Lyft.

## How detection works / limits

- `LiveWatchService.kt`: foreground service (`mediaProjection` type), notification with Stop action, **one** MediaProjection → **one** virtual display per consent; resize uses `VirtualDisplay.resize()` and `.setSurface()`. Capture resolution capped at 1080 px wide; `ImageReader` frames decoded in memory, cropped to the bottom 66%, throttled ~2 seconds, image processing single-flight. No saved screenshots. Pauses OCR when the display is off.
- `LiveOfferGate.kt`: app-specific offer cues (UberX/Match or Lyft/Accept/Incl.), a dollar amount, and a combined distance/time leg. Rejects ordinary maps/screens that do not have these cues.
- `OfferParser.kt` (unchanged v1): extracts the largest leading fare (ignoring Lyft hourly-rate), pickup, trip, included bonus, rating, and address-like dropoff/pickup; sanitizes OCR text with `CardPrivacy` allow-list. The engine rejects invalid/implausible offers. **It can still produce false positives / false negatives**; no live frame from a Samsung has been calibrated yet.
- `LiveOfferDedup.kt`: numeric/address fingerprint with a 90s cooldown to avoid logging the same offer repeated across OCR frames or transient screen flickers. A changed fare/trip fingerprint logs immediately. Two offers with indistinguishable details inside 90 seconds may be treated as one; if OCR changes a number significantly, duplicates are possible.
- `LiveOverlay.kt`: overlay near top (72 dp from top), not near the bottom Accept button. Auto-fade at ~4.6s, tap to dismiss; uses a window type allowed for user-approved overlays. If permission denied/revoked, high-priority verdict notifications are used when notifications are allowed.
- `LiveWatchState.kt`: in-process UI state for status/feed. `OfferDatabase` remains the durable source of truth. Live scanning and logging run in the **foreground service**; **sync runs only in main UI** and only if enabled.

**Latency / battery:** Capture is sampled about every two seconds, plus ML Kit OCR latency, so the verdict is **not instantaneous**. ML Kit and a screen-capture foreground service consume battery; do not assume they are free to run for a long shift until measured on the actual Galaxy. Android screen-off skips analysis; session remains active until Stop/system revocation; Android may stop capture at any time.

## Unchanged grading and data

Exact v1 rule: pickup miles/minutes included; if one-way **trip miles >= 75**, assume empty return of the same miles/minutes. For keyword-matched **dead-zone dropoff**, add **8 miles / 25 minutes**, stacking with long return. Effective distance/time are used for operating cost ($0.20/mile default) and NET grading. RED if net$/mile < 0.90 **OR** net$/hour < 20. GREEN if net$/mile >= 1.25 **AND** net$/hour >= 30 **AND** pickup complete; otherwise YELLOW. Defaults are editable in Settings and explicitly provisional; **no math or threshold code was changed from v1**.

| Reference transcript | NET $/mile | NET $/hour | Stored verdict | Live badge |
|---|---:|---:|---|---|
| UberX Vienna → Arlington, $41.87 (includes +$18) | **3.31849** | **74.04375** | **GREEN** | **ACCEPT** |
| Lyft Comfort DC → NYC, $449 incl $50; 464.7 effective miles / 543 minutes | **0.76622** | **39.34** | **RED** | **SKIP** |

Each recognized offer is saved immediately in existing local SQLite table `offers` with platform/time/fare/legs/NET costs/verdict/address-like text/redacted OCR. Older v1 records are preserved (same database/schema/application ID). History detail, CSV/JSON export, manual outcome buttons, wait table, zones asset, voice switch, and optional sync contract remain unchanged. No new wait tracking was added. The driver may mark outcomes later from the History/Ver­dict screens; live capture never infers acceptance.

### Privacy and network

- **No images are persisted** or sent to any server; image memory is recycled. Stored `rawText` is produced by `CardPrivacy.sanitize`, stripping isolated and grouped name-like lines such as `Josh` and `Josh Verified ★4.8`; `pickupText`/`dropoffText` come only from address-looking lines. This is a rules-based sanitizer and **cannot guarantee** that a rider name mistakenly recognized as part of an address never survives. Review before enabling sync.
- **Sync defaults OFF**, and `SyncService` exits before URL/network code when disabled. The capture service has **no networking calls**. Enabling sync in Settings uploads redacted records to your configured HTTPS endpoint, as described in the v1 README/`Docs/RESULTS.md`. There is no automatic background sync.
- Google's ML Kit can transmit independent SDK diagnostics/usage telemetry according to its terms even when app sync is OFF; the OCR image itself stays on device. Absolute zero third-party SDK networking cannot be promised. See <https://developers.google.com/ml-kit/terms>.

## Pinned build stack

| Item | Exact value |
|---|---|
| Gradle wrapper distribution | **8.13** |
| AGP | **8.13.2** |
| Kotlin Android / Compose Compiler plugin | **2.3.10** |
| compileSdk / targetSdk / minSdk | **36 / 36 / 26** |
| Compose BOM | **2025.09.01** |
| activity-compose | **1.11.0** |
| bundled ML Kit Latin text-recognition | **16.0.1** |
| Kotlin coroutines android | **1.10.2** |
| applicationId | **com.rideoffercopilot.android** |
| versionName / versionCode | **2.0.0 / 2** |
| Kotlin compiler target | `kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }` |

No additional runtime libraries were added. Signing config was **not altered** from the v1 project (debug builds use standard Android debug signing; no paid service needed).

## Build Windows or CI (source only)

1. Extract the ZIP; open folder `RideOfferCopilot-Android` containing `settings.gradle.kts` in Android Studio. Install JDK **17**, Android SDK Platform **36** and Build Tools **36.0.0**; initial dependency download requires internet.
2. Windows terminal in project root:
   ```bat
   gradlew.bat :app:testDebugUnitTest :app:assembleDebug
   ```
   On macOS/Linux: `./gradlew :app:testDebugUnitTest :app:assembleDebug`. For source-only local checks run `python3 Scripts/check_source.py` or `./Scripts/run-core-smoke.sh` (needs `kotlinc`).
3. If the Gradle build succeeds, the unsigned-by-you **debug-signed** APK will be at `app/build/outputs/apk/debug/app-debug.apk`. Copy to Samsung and allow unknown-app installation or use `adb install -r app/build/outputs/apk/debug/app-debug.apk`. **No APK is included in this ZIP.**
4. CI: push project root to GitHub → **Actions → Android debug build → Run workflow**. The existing `.github/workflows/android-debug.yml` verifies source, runs JUnit and assembles APK, then uploads an artifact if successful. No paid Google Play or Apple account required.
5. For a smoke test, start live watch, allow **Entire screen**, switch to a static test screenshot on the phone (e.g. Gallery viewing the provided fixture), and verify one detection plus no duplicate after several frames; then test real Uber/Lyft offers only while safely parked. Test notification Stop, overlay denial, battery and long shift separately.

**Gradle wrapper limitation inherited from v1:** The authoring environment could not obtain the official `gradle-wrapper.jar`; it is **NOT bundled**. `gradlew` / `gradlew.bat` download the official Gradle 8.13 wrapper JAR on first run, verify SHA-256 `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`, then launch Gradle. The distribution itself has pinned SHA-256 in `gradle-wrapper.properties`. First CI/Android Studio build requires access to Gradle's download service; **build success is not guaranteed until tested**.

## Verification

- `Scripts/check_source.py` — pinned versions, v2 foreground-service/permission declarations, networking/QA invariants.
- `Scripts/run-core-smoke.sh` — offline Kotlin logic: original Uber/Lyft numbers, bonus, privacy, zone/long-trip, detection gate, consecutive-frame dedup + changed offer. Transcribed OCR fixtures only.
- `app/src/test/.../DomainTests.kt` — **9 existing JUnit tests, unchanged**.
- `app/src/test/.../LiveWatchTests.kt` — **5 new JUnit tests** for offer gate, normal screens rejection, repeated-card dedup, changed offers and reset.
- `Docs/RESULTS.md` — exact test execution, what remains untested and acceptance checklist for Kiko.

**Official Android platform reference:** <https://developer.android.com/media/grow/media-projection> and <https://developer.android.com/develop/background-work/services/fgs/service-types>.
