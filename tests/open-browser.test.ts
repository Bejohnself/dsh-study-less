import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserCommand } from '../web/openBrowser.ts'

const url = 'http://127.0.0.1:7801'

/** 每个平台都用系统自带的 opener：不加依赖。 */
test('each platform opens the URL with its own opener', () => {
  assert.deepEqual(browserCommand('darwin', false, url), { command: 'open', args: [url] })
  assert.deepEqual(browserCommand('win32', false, url), {
    command: 'cmd',
    args: ['/c', 'start', '', url],
  })
  assert.deepEqual(browserCommand('linux', false, url), { command: 'xdg-open', args: [url] })
})

/** WSL 里没有 xdg-open 的发行版很多，走 Windows 的 cmd.exe。 */
test('WSL hands the URL to Windows instead of xdg-open', () => {
  assert.deepEqual(browserCommand('linux', true, url), {
    command: 'cmd.exe',
    args: ['/c', 'start', '', url],
  })
})