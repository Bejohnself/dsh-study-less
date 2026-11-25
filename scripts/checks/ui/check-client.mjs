/**
 * Load the built client bundle under a stub module loader.
 *
 * The shell serves bundles that register a CJS factory; this checks the same
 * shape locally: the factory must hand back `apply`/`inject`, and `apply` must
 * register the sidebar row and the main page without touching the DOM.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const bundlePath = fileURLToPath(new URL('../../../lib/client.js', import.meta.url))
const source = await readFile(bundlePath, 'utf8')

class Component {
  constructor(props) {
    this.props = props
  }
  setState(next) {
    this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }
  }
}

const react = {
  Component,
  createElement: (...args) => ({ __element: true, args }),
  Fragment: 'Fragment',
  useState: value => [typeof value === 'function' ? value() : value, () => undefined],
  useEffect: () => undefined,
  useMemo: fn => fn(),
  useRef: value => ({ current: value }),
  useCallback: fn => fn,
  useContext: () => undefined,
  createContext: value => ({ _currentValue: value, Provider: (props) => props.children }),
}

const jsxRuntime = {
  jsx: (type, props) => ({ __element: true, type, props }),
  jsxs: (type, props) => ({ __element: true, type, props }),
  Fragment: 'Fragment',
}

const stubs = {
  react,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': {},
}

const registrations = []
const injections = []

const slots = {
  inject(key, callback) {
    injections.push(key)
    const dispose = callback()
    return dispose
  },
  register(options, component) {
    registrations.push({ options, component })
    return () => undefined
  },
}

const effects = []
const ctx = {
  slots,
  effect(fn, label) {
    effects.push({ label, dispose: fn() ?? undefined })
  },
}

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

// eslint-disable-next-line no-eval
const run = new Function('window', 'document', 'fetch', 'console', source)
run(globalThis.window, undefined, () => Promise.reject(new Error('no network in the stub')), console)

if (loaded === undefined) throw new Error('bundle did not call __ModuleLoader__.load')
if (loaded.id !== 'dsh-study-less') throw new Error(`unexpected id: ${loaded.id}`)

const exports = loaded.factory(request => {
  if (!(request in stubs)) throw new Error(`unexpected module request: ${request}`)
  return stubs[request]
})

if (typeof exports.apply !== 'function') throw new Error('missing apply export')
if (!Array.isArray(exports.inject) || exports.inject[0] !== 'slots') throw new Error('missing slots inject')
if (typeof exports.STUDY_PANEL_ID !== 'string') throw new Error('missing panel id export')

exports.apply(ctx)

const row = registrations.find(entry => entry.options.name === 'sidebar.panellist')
const page = registrations.find(entry => entry.options.name === 'main')
if (row === undefined) throw new Error('sidebar row was not registered')
if (page === undefined) throw new Error('main page was not registered')
if (row.options.id !== 'study-desk' || page.options.key !== 'study-desk') {
  throw new Error('panel ids disagree')
}

// 计划页的知识点板块曾经借用洞察页掌握度条的 .study-mastery；reading.ts 里那条
// display:flex 会把整块 section 排成左右两栏。板块必须有自己的 class。
if (!/className:"study-knowledge"/u.test(source)) {
  throw new Error('plan knowledge section has no class of its own (legacy .study-mastery collision)')
}

// 今天页「接着读」的理由是生成的文案，常带 $...$ 公式；它必须经 Markdown 渲染，
// 当纯文本插值时页面只会显示原始 $ 和 \。这份 bundle 是唯一能便宜验证接线的地方。
const nextWhy = /study-next-why",children:\(0,[\w$]+\.jsx\)\([\w$]+,\{source:[\w$]+\.next\.why\}\)/u
if (!nextWhy.test(source)) throw new Error('today next-step why is not rendered as markdown')

for (const { dispose } of effects) dispose()

console.log('client bundle OK')
console.log('  loaded id:', loaded.id)
console.log('  inject:', exports.inject.join(', '))
console.log('  injections:', injections.join(', '))
console.log('  registrations:', registrations.map(entry => `${entry.options.name}:${entry.options.id ?? entry.options.key}`).join(', '))
