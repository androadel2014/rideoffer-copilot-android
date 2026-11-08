# RideOffer Copilot — Android personal trial (source only)

Kotlin / Jetpack Compose, single activity, English-only UI, no ads or accounts. Target: Samsung Galaxy S25 Ultra running Android 8+ (API 26+). This is a **screenshot-based manual import** companion, not a live capture, screen overlay, notification listener, or automatic driver.

## What is implemented

- Home: large **Import offer screenshot** system photo picker and Android share-sheet `ACTION_SEND image/*` receiver. The app reads a granted image URI in memory and does **not save** the screenshot.
- Bundled, on-device Latin ML Kit OCR followed by one full-card pattern parser; extracts fare, pickup/trip legs, ratings, included bonus and surge multiplier, addresses. Rejects cards without a positive fare and trip distance/duration. Uber total-leg duplication is removed.
- Original iOS v1.1.1 net-grading rules: pickup included, empty return for trip distance >=75mi, dead-zone reposition penalties, cost-per-mile subtraction, green/yellow/red thresholds. **Thresholds and costs are PROVISIONAL** until actual trip calibration.
- Verdict: large ACCEPT / BORDERLINE / DECLINE, metrics and reasons, Android TextToSpeech (English), manual accepted/declined/discard actions. No automated Uber/Lyft interaction.
- History: local SQLite, complete offer detail including **allow-listed redacted OCR text**, CSV/JSON offers and waits exports via Android's Save Document picker, delete-all confirmation.
- Settings: all requested numeric boundaries, driver ID, voice + Uber/Lyft flags, optional HTTPS sync URL and key, OFF-by-default sync switch, Sync now and last-status. Driver key is AES/GCM encrypted with a nonexportable Android Keystore key.
- Wait record **model and SQLite table** exist. No automatic wait tracking is performed by this screenshot trial, and the waits list initially remains empty.
- Zones.json is copied **verbatim** from iOS v1.1.1; it is a bundled, non-UI-editable configuration. Longest word-boundary keyword wins; dead wins ties.

## EXACT build versions (fixed)

| Component | Version |
|---|---|
| Gradle distribution | **8.13** |
| Android Gradle Plugin | **8.13.2** |
| Kotlin Android + Compose compiler plugin | **2.3.10** |
| compileSdk / targetSdk / minSdk | **36 / 36 / 26** |
| Compose BOM | **2025.09.01** |
| `androidx.activity:activity-compose` | **1.11.0** |
| `com.google.mlkit:text-recognition` (bundled) | **16.0.1** |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | **1.10.2** |
| Android application ID | **com.rideoffercopilot.android** |
| App versionName / versionCode | **1.0.0 / 1** |

Uses the required `kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }` DSL. No `kotlinOptions` or Compose 1.12.x. No broad photo storage, overlays, accessibility, or location permissions. Only INTERNET for the optional sync feature.

## Build a debug APK yourself (Windows, Android Studio)

1. Extract `RideOfferCopilot-Android` from the ZIP. Install Android Studio, JDK 17 and Android SDK Platform 36/Build Tools 36.0.0 if not already present.
2. Open the folder containing `settings.gradle.kts` in Android Studio. Let the IDE sync Gradle; it needs internet **for Gradle/plugins/dependencies** the first time.
3. Use **Build → Build Bundle(s) / APK(s) → Build APK(s)**, or in a Windows terminal in this folder:
   ```bat
   gradlew.bat :app:testDebugUnitTest :app:assembleDebug
   ```
4. A successful build generates `app\build\outputs\apk\debug\app-debug.apk`. **No prebuilt APK is supplied or claimed**.
5. Transfer the debug APK to the S25 Ultra and tap the file to install (allow “Install unknown apps” for the chosen file manager if Android asks). Or enable USB debugging and run `adb install -r app\build\outputs\apk\debug\app-debug.apk`.
6. Open the app, leave sync OFF, set thresholds and operating cost, import one of your own screenshots using the picker or from Samsung Gallery → Share → RideOffer Copilot. Verify all extracted amounts before acting. Use “Mark accepted/declined” or “Not an offer / wrong parse”.
7. Optional: enable sync only after the server endpoint has been tested, set HTTPS URL + driver key, press Save, then Sync now.

**Important wrapper binary limitation:** This environment had no internet access to retrieve the official `gradle-wrapper.jar`. To avoid shipping an unverified or counterfeit binary, this ZIP contains `gradlew`, `gradlew.bat`, `gradle-wrapper.properties`, and the official Gradle 8.13 SHA-256. The wrapper properties also pin the Gradle 8.13 binary distribution SHA-256. On **first invocation**, the scripts download the *official* Gradle 8.13 wrapper JAR from Gradle's distribution service and verify its published checksum `81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f`; if verification fails, they stop. Thus **the requested prebundled official JAR is not present in this archive**; this limitation is not a claim of full compliance. After the first successful bootstrap the official JAR is stored in `gradle/wrapper/`. If your CI requires a prebundled JAR, fetch and commit the checksum-verified official file separately before the build.

### Alternative GitHub Actions build

The included `.github/workflows/android-debug.yml` configures JDK 17, Android SDK 36, runs checks and `:app:testDebugUnitTest :app:assembleDebug`, and uploads the generated APK as an artifact. Upload the project root to a GitHub repo, open **Actions → Android debug build → Run workflow**, and inspect the build log. **Workflow has not been executed from this environment.**

## Data, privacy and networking

- Screenshots are decoded in memory, passed to the **bundled** ML Kit text recognizer, then recycled. This feature requires no network upload.
- **SDK-level network caveat:** ML Kit documents that although image/text input remains on-device, its SDK can make independent requests for metrics, bug fixes, and compatibility information. With sync OFF, **our own app code** does not open any network connections, but we cannot guarantee the ML Kit library performs zero requests. This is an inherent conflict between the required ML Kit dependency and a strict app-wide zero-networking promise. See https://developers.google.com/ml-kit/terms .
- The OCR sanitizer is a *positive allow-list* based on `CardOCRPrivacy.sanitize` from the iOS source, tightened to reject bare name-like street-suffix text without address context. It drops isolated rider names and cuts unknown prefixes before `Verified`, `rating`, ★/☆ when the line is not an address/amount/leg; other lines only survive if they look like money, duration/distance, a known label, a rating, or a street/place address. All saved and synced `rawText`/`raw_text` are re-sanitized. `pickupText`/`dropoffText` are address-looking text only. **Heuristics cannot mathematically guarantee removal of a name embedded in an address-like line**; review before enabling sync.
- Offers and waits are local SQLite (`rideoffer.db`). Offers fields use the iOS `OfferRecord` property names; the sync service serializes the separately specified snake_case contract. `timestamp` and `started_at` columns are Unix **milliseconds** stored as `REAL`, ISO8601 UTC only for network/CSV.
- App-owned network logic **never** invokes `HttpURLConnection` while sync is OFF. Both the UI trigger and the network service independently read the OFF-by-default setting before any network call. Synchronization is **foreground-only**, on opening the app (if enabled) or tapping Sync now; no background service, WorkManager, or network call from OCR.
- POST `{base}/api/rideoffer/v1/ingest`, `X-Driver-Key` from encrypted preferences; at most 200 combined offers/waits per batch; HTTP 200 with `accepted == size` required to mark exactly unchanged documents `synced_at`, 401 and all other failures retain queue, 20s connect/read timeouts. When driver ID changes, records are sent in same-driver-ID batches.
- Changing the sync toggle OFF while a network request is already in flight does **not** physically cancel that previously authorized HTTP request; no **new** batch starts. Do not enable sync if you never want the already queued data sent.
- `waits` are not generated automatically in the Android trial, but their table/export/payload support is implemented. No remote response or server test is claimed.

## Tests, fixture images, known limits

- `Scripts/check_source.py` verifies pinned versions, permissions, zones, sanitization/sync guards and wrapper configuration.
- `Scripts/run-core-smoke.sh` compiles/runs **pure Kotlin** model, parser and decision logic with `kotlinc` and Java. No SDK needed. It uses **transcribed text fixtures** rather than actual ML Kit output.
- `app/src/test/.../DomainTests.kt` contains 9 JUnit tests for the two supplied cards, rearranged layout, summaries, bonuses, zones, long threshold, missing pickup, privacy, sync payload explicit nulls/outcome mapping, invalid settings. Execute with `:app:testDebugUnitTest` when Android SDK/Gradle are available.
- `Docs/fixtures/` includes the two **real screenshot references**; the rider-name area in the Lyft picture has been covered before bundling. Those fixture JPEGs are **documentation only**, not app assets, local user history, or exported records.
- Limitations: no Android SDK / Gradle available here; **no Gradle/AGP build, JUnit Gradle run, APK install, phone ML Kit OCR, photo picker, TTS, or sync-server integration test was performed**. Text-level parser math was run and passed. Test the screenshots on the S25 Ultra before relying on a verdict; screenshot formats and OCR errors can change.

See [`Docs/RESULTS.md`](Docs/RESULTS.md) for audited checks and handoff to Kiko.
