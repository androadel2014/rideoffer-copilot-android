#!/usr/bin/env python3
"""Offline source/package guard (NOT a replacement for Gradle/Android SDK build)."""
from pathlib import Path
import json, re, hashlib, sys
root=Path(__file__).resolve().parents[1]
app=(root/'app/build.gradle.kts').read_text()
base=(root/'build.gradle.kts').read_text()
manifest=(root/'app/src/main/AndroidManifest.xml').read_text()
source='\n'.join(p.read_text() for p in (root/'app/src/main/java').rglob('*.kt'))
zone=json.loads((root/'app/src/main/assets/Zones.json').read_text())
assert zone['version']==1
assert len(zone['hot'])==14 and len(zone['neutral'])==6 and len(zone['dead'])==9
assert 'version "8.13.2"' in base and base.count('version "2.3.10"')==2
for dep in ('compileSdk = 36','targetSdk = 36','minSdk = 26','compose-bom:2025.09.01','activity-compose:1.11.0','text-recognition:16.0.1','JvmTarget.JVM_17'):
    assert dep in app, dep
assert 'kotlinOptions {' not in app
assert '1.12.' not in app
assert 'android.intent.action.SEND' in manifest and 'image/*' in manifest
assert 'android.permission.INTERNET' in manifest
for permission in ('FOREGROUND_SERVICE_MEDIA_PROJECTION','FOREGROUND_SERVICE','SYSTEM_ALERT_WINDOW','POST_NOTIFICATIONS'):
    assert permission in manifest,permission
assert 'android:foregroundServiceType="mediaProjection"' in manifest
assert 'android:name=".LiveWatchService"' in manifest
assert 'versionCode = 2' in app and 'versionName = "2.0.0"' in app
assert 'applicationId = "com.rideoffercopilot.android"' in app
for forbidden in ('ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','READ_EXTERNAL_STORAGE','MANAGE_EXTERNAL_STORAGE','BIND_ACCESSIBILITY_SERVICE'):
    assert forbidden not in manifest
assert 'if(!settings.syncEnabled)' in source or 'if (!settings.syncEnabled)' in source
assert 'if(!prefs.load().syncEnabled)' in source
assert 'TextRecognition.getClient' in source
for term in ('MediaProjectionManager','createScreenCaptureIntent','FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION',
             'registerCallback','createVirtualDisplay','acquireLatestImage','LiveOfferDedup',
             'POST_NOTIFICATIONS','Settings.canDrawOverlays','ACTION_STOP','Overlay'):
    assert term in source, term
assert 'AccessibilityService' not in source
assert 'CardPrivacy.sanitize' in source
assert 'AES/GCM/NoPadding' in source
for file in ('app/src/test/java/com/rideoffercopilot/android/DomainTests.kt',
             'app/src/test/java/com/rideoffercopilot/android/LiveWatchTests.kt',
             'app/src/test/resources/uber-transcript.txt','app/src/test/resources/lyft-transcript.txt',
             'gradlew','gradlew.bat','gradle/wrapper/gradle-wrapper.properties'):
    assert (root/file).is_file(),file
assert 'gradle-8.13-bin.zip' in (root/'gradle/wrapper/gradle-wrapper.properties').read_text()
assert 'distributionSha256Sum=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78' in (root/'gradle/wrapper/gradle-wrapper.properties').read_text()
assert 'https://services.gradle.org/distributions/gradle-8.13-wrapper.jar' in (root/'gradlew').read_text()
assert 'https://services.gradle.org/distributions/gradle-8.13-wrapper.jar' in (root/'gradlew.bat').read_text()
jar=root/'gradle/wrapper/gradle-wrapper.jar'
if jar.exists():
    expected='81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f'
    assert hashlib.sha256(jar.read_bytes()).hexdigest()==expected,'Official wrapper JAR checksum failed'
else:
    print('LIMITATION: official wrapper JAR not shipped; gradlew and gradlew.bat fetch/check it on first build.')
print('PASS: v2 pinned stack, capture permissions, foreground service, privacy, live detection, source structure')
