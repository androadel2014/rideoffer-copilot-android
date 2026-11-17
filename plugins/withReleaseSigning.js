/**
 * Config plugin: lets a plain Gradle build (GitHub Actions "gradle" path) sign the release
 * AAB with your Play upload key, read from environment variables. EAS builds ignore this
 * and use EAS-managed credentials. Without the env vars, the template's debug signing stays.
 *
 *   ROC_UPLOAD_STORE_FILE, ROC_UPLOAD_STORE_PASSWORD, ROC_UPLOAD_KEY_ALIAS, ROC_UPLOAD_KEY_PASSWORD
 *   ROC_VERSION_CODE (optional) overrides versionCode so every CI upload is unique.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes('ROC_UPLOAD_STORE_FILE')) return cfg;
    g = g.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        upload {
            if (System.getenv("ROC_UPLOAD_STORE_FILE")) {
                storeFile file(System.getenv("ROC_UPLOAD_STORE_FILE"))
                storePassword System.getenv("ROC_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("ROC_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("ROC_UPLOAD_KEY_PASSWORD")
            }
        }`
    );
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig System.getenv("ROC_UPLOAD_STORE_FILE") ? signingConfigs.upload : signingConfigs.debug`
    );
    // Gate fix (2026-11-15): the inline Elvis expression failed Gradle project
    // evaluation in CI ("Value is null" at the versionCode line). Hoist it into a
    // plain def above the android block instead.
    g = g.replace(
      /versionCode\s+(\d+)/,
      'versionCode rocVersionCode'
    );
    if (!g.includes('rocVersionCode =')) {
      g = g.replace(
        /(^|\n)android\s*\{/,
        `$1def rocVersionCode = (System.getenv("ROC_VERSION_CODE") ?: "13").toInteger()\nandroid {`
      );
    }
    cfg.modResults.contents = g;
    return cfg;
  });
};
