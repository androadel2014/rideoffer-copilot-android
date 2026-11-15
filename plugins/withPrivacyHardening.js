/**
 * Config plugin: privacy hardening for the generated Android manifest.
 *
 * Google ML Kit (bundled text-recognition) ships a telemetry pipeline built on
 * com.google.android.datatransport. Its uploader discovers backends through the
 * TransportBackendDiscovery service. Removing that service from the merged
 * manifest leaves the pipeline with no registered backend, so telemetry events
 * are dropped on-device instead of being uploaded. Our own code never opens a
 * socket unless the user enables Sync (see src/net/).
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const REMOVE_SERVICES = ['com.google.android.datatransport.runtime.backends.TransportBackendDiscovery'];

module.exports = function withPrivacyHardening(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$ = app.$ || {};
    app.$['android:allowBackup'] = 'false';
    app.$['android:usesCleartextTraffic'] = 'false';
    app.service = app.service || [];
    for (const name of REMOVE_SERVICES) {
      if (!app.service.some((s) => s.$ && s.$['android:name'] === name)) {
        app.service.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
      }
    }
    return cfg;
  });
};
