/**
 * 开发入口开关：测试时钟、重启插件、练习里的「填正确答案 / 填错误答案」默认不出现。
 *
 * 打开方式二选一：地址栏加 `?dev=1`，或控制台执行
 * `localStorage.setItem('study:dev', '1')`（删掉键或不带参数即关闭）。
 * 只藏界面，不动服务端：`/clock`、`/plugin/restart` 仍然可调，这是本地单人应用，
 * 藏按钮的目的是不打扰使用者，不是做权限。
 */
const KEY = 'study:dev'

export function isDevMode(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('dev')) return true
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}