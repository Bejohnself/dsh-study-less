/**
 * 启动后把网页推给桌面浏览器。
 *
 * 与 `server.ts` 分开是为了可测：平台命令表是纯函数，起服务要开端口、碰数据目录。
 * 用系统自带的 opener，不引入依赖；调不起来只少一步便利，URL 已经打印在控制台上。
 */
import { spawn } from 'node:child_process'

export interface BrowserCommand {
  command: string
  args: string[]
}

/** 各平台打开一个 URL 的命令；WSL 里用 Windows 的 `cmd.exe`。 */
export function browserCommand(platform: NodeJS.Platform, inWsl: boolean, url: string): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  if (inWsl) return { command: 'cmd.exe', args: ['/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/** 起服务后打开一次；`STUDY_NO_OPEN=1` 关掉（CI、远程终端、自己开浏览器时）。 */
export function openBrowser(url: string): void {
  if (process.env.STUDY_NO_OPEN === '1') return
  const { command, args } = browserCommand(
    process.platform,
    process.env.WSL_DISTRO_NAME !== undefined,
    url,
  )
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    // 没有浏览器 / opener 不存在：别让一个便利功能把服务拖下水。
    child.on('error', () => undefined)
    child.unref()
  } catch {
    // 同上：URL 已经在控制台里。
  }
}