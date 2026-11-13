/**
 * Host-owned study settings.
 *
 * The file sits in the study root and is written 0600. Reads are normalized over
 * defaults, so an older document gains new fields without a migration step.
 */
import { chmod } from 'node:fs/promises'
import { normalizeSettings, patchSettings } from '../core/settings.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { readJson, writeJsonAtomic } from '../core/store.ts'
import type { StudySettings } from '../core/types.ts'
import type { SettingsUpdate } from '../core/views.ts'

/** Read, patch and persist the settings document. */
export class SettingsService {
  readonly paths: LibraryPaths

  constructor(paths: LibraryPaths) {
    this.paths = paths
  }

  /** Current settings, normalized over defaults. */
  async current(): Promise<StudySettings> {
    return normalizeSettings(await readJson<unknown>(this.paths.settingsFile, null))
  }

  /** Apply a patch and persist it. */
  async patch(patch: SettingsUpdate): Promise<StudySettings> {
    const next = patchSettings(await this.current(), patch)
    await writeJsonAtomic(this.paths.settingsFile, next)
    // The setting file can hold API keys; keep it owner-only where the platform
    // supports POSIX modes. A failure here is not fatal (Windows/WSL quirks).
    await chmod(this.paths.settingsFile, 0o600).catch(() => undefined)
    return next
  }
}
