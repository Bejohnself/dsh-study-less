/**
 * Live restart of this plugin's own loader entry.
 *
 * The route answers first, then the entry is switched off and on again. The
 * browser polls /health and reloads once the Host is back. This never touches
 * the DSH process or other plugins.
 */
export interface RestartContext {
  get(name: string): unknown
  fiber?: unknown
}

interface LoaderEntry {
  id: string
  options?: { id?: string; name?: string; disabled?: boolean }
  update(patch: { disabled: boolean }, write?: boolean, transient?: boolean): Promise<unknown>
}

interface LoaderFace {
  locate?(fiber: unknown): string | undefined
  entries(): Iterable<LoaderEntry>
}

let restarting = false

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Schedule a disable → enable cycle for this plugin.
 * @throws when the host has no loader or the entry cannot be found.
 */
export function schedulePluginRestart(ctx: RestartContext, pluginId: string, entryId = 'study-desk'): void {
  if (restarting) throw new Error('插件正在重启，请稍候')
  let loader: LoaderFace | undefined
  try {
    loader = ctx.get('loader') as LoaderFace | undefined
  } catch {
    loader = undefined
  }
  if (loader === undefined || typeof loader.entries !== 'function') {
    throw new Error('当前 DSH 不支持单插件重启；请重载插件或重启 DSH')
  }
  let located: string | undefined
  try {
    located = typeof loader.locate === 'function' ? loader.locate(ctx.fiber) : undefined
  } catch {
    located = undefined
  }
  let entries: LoaderEntry[]
  try {
    entries = [...loader.entries()]
  } catch {
    throw new Error('读取插件加载项失败；请重载插件或重启 DSH')
  }
  const entry =
    (located === undefined ? undefined : entries.find(candidate => candidate.id === located)) ??
    entries.find(candidate => candidate.options?.id === entryId) ??
    entries.find(candidate => candidate.options?.name === pluginId)
  if (entry === undefined) throw new Error('找不到知止插件的加载项；请重载插件或重启 DSH')

  restarting = true
  // Let the HTTP response reach the browser before the plugin is disposed.
  setTimeout(() => {
    void (async () => {
      try {
        await entry.update({ disabled: true }, false, true)
        await delay(300)
        try {
          await entry.update({ disabled: false }, false, true)
        } catch (error) {
          // One retry: a failed enable would otherwise leave the plugin off.
          console.warn('[dsh-study-less] plugin restart enable failed, retrying:', error)
          await delay(800)
          await entry.update({ disabled: false }, false, true)
        }
      } catch (error) {
        console.error('[dsh-study-less] plugin restart failed:', error)
      } finally {
        restarting = false
      }
    })()
  }, 120)
}
