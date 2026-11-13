/**
 * Single source of the plugin version.
 *
 * `scripts/build.mjs` injects `__STUDY_VERSION__` from package.json for the Host
 * bundle, so the manifest, the health endpoint and any diagnostics cannot drift
 * apart. Direct source imports (tests, ad-hoc scripts) fall back to "dev".
 */
declare const __STUDY_VERSION__: string

/** Version reported by the Host and the health endpoint. */
export const PLUGIN_VERSION =
  typeof __STUDY_VERSION__ === 'string' && __STUDY_VERSION__.length > 0 ? __STUDY_VERSION__ : 'dev'
