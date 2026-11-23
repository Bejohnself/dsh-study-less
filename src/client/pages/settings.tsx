/**
 * Settings: generation engines, study preferences and the text-engine test.
 *
 * Secrets never travel back from the Host: the form only knows whether a key is
 * stored, and an empty field means "keep the existing one".
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { SettingsView, UsageSummaryView } from '../../core/views.ts'
import type { QuickAction } from '../../core/types.ts'
import { MAX_QUICK_ACTIONS, QUICK_LABEL_MAX, QUICK_PROMPT_MAX } from '../../core/settings.ts'
import { api, errorText, post } from '../api.ts'
import { ErrorNote, Modal, THEME_STEPS, Toast, themeLabel } from '../components/ui.tsx'
import { formatCost, formatTokens, UsageHeatmap } from '../components/usage.tsx'
import { getPreference, setPreference as applyThemePreference, subscribePreference, type ThemePreference } from '../theme.ts'

type CapabilityKey = 'image' | 'animation' | 'embedding'

/** The settings modal. */
export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): ReactElement {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [preference, setLocalPreference] = useState<ThemePreference>(getPreference())

  useEffect(() => subscribePreference(setLocalPreference), [])

  const [kind, setKind] = useState<'dsh' | 'openai-compatible'>('dsh')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('0.3')
  const [maxTokens, setMaxTokens] = useState('4096')
  const [timeoutMs, setTimeoutMs] = useState('120000')
  const [clearKey, setClearKey] = useState(false)

  const [caps, setCaps] = useState<Record<CapabilityKey, { enabled: boolean; baseURL: string; model: string; apiKeyEnv: string }>>({
    image: { enabled: false, baseURL: '', model: '', apiKeyEnv: '' },
    animation: { enabled: false, baseURL: '', model: '', apiKeyEnv: '' },
    embedding: { enabled: false, baseURL: '', model: '', apiKeyEnv: '' },
  })
  const [animationMode, setAnimationMode] = useState<'svg-html' | 'video'>('svg-html')
  const [quickActions, setQuickActions] = useState<QuickAction[]>([])

  const [targetRetention, setTargetRetention] = useState('0.9')
  const [maxIntervalDays, setMaxIntervalDays] = useState('365')
  const [dailyNewUnits, setDailyNewUnits] = useState('0')
  const [autoQuiz, setAutoQuiz] = useState(true)
  const [verifyNotes, setVerifyNotes] = useState(false)
  const [priceCurrency, setPriceCurrency] = useState<'USD' | 'CNY'>('USD')
  const [inputPrice, setInputPrice] = useState('0')
  const [cacheInputPrice, setCacheInputPrice] = useState('0')
  const [outputPrice, setOutputPrice] = useState('0')
  const [usage, setUsage] = useState<UsageSummaryView | null>(null)

  useEffect(() => {
    let alive = true
    api<SettingsView>('/settings')
      .then(value => {
        if (!alive) return
        setView(value)
        setKind(value.text.kind)
        setBaseURL(value.text.baseURL ?? '')
        setApiKeyEnv(value.text.apiKeyEnv ?? '')
        setModel(value.text.model ?? '')
        setTemperature(String(value.text.temperature ?? 0.3))
        setMaxTokens(String(value.text.maxTokens ?? 4096))
        setTimeoutMs(String(value.text.timeoutMs ?? 120000))
        setCaps({
          image: { enabled: value.image.enabled, baseURL: value.image.baseURL ?? '', model: value.image.model ?? '', apiKeyEnv: value.image.apiKeyEnv ?? '' },
          animation: {
            enabled: value.animation.enabled,
            baseURL: value.animation.baseURL ?? '',
            model: value.animation.model ?? '',
            apiKeyEnv: value.animation.apiKeyEnv ?? '',
          },
          embedding: {
            enabled: value.embedding.enabled,
            baseURL: value.embedding.baseURL ?? '',
            model: value.embedding.model ?? '',
            apiKeyEnv: value.embedding.apiKeyEnv ?? '',
          },
        })
        setAnimationMode(value.animation.mode)
        setQuickActions((value.study.quickActions ?? []).map(action => ({ ...action })))
        setTargetRetention(String(value.study.targetRetention))
        setMaxIntervalDays(String(value.study.maxIntervalDays))
        setDailyNewUnits(String(value.study.dailyNewUnits))
        setAutoQuiz(value.study.autoQuiz)
        setVerifyNotes(value.study.verifyNotes)
        setPriceCurrency(value.study.pricing?.currency === 'CNY' ? 'CNY' : 'USD')
        setInputPrice(String(value.study.pricing?.inputPerMillion ?? 0))
        setCacheInputPrice(String(value.study.pricing?.cacheInputPerMillion ?? 0))
        setOutputPrice(String(value.study.pricing?.outputPerMillion ?? 0))
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let alive = true
    api<UsageSummaryView>('/usage')
      .then(value => {
        if (alive) setUsage(value)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [view?.updatedAt])

  const test = async (): Promise<void> => {
    setTestResult('测试中…')
    try {
      const result = await post<{ ok: boolean; engine?: string; model?: string; latencyMs?: number; message?: string; reply?: string }>('/settings/test', { kind: 'text' })
      setTestResult(
        result.ok
          ? `可用 · ${result.engine ?? result.model ?? 'text'} · ${result.latencyMs ?? '?'}ms${result.reply === undefined ? '' : ` · ${result.reply}`}`
          : `不可用：${result.message ?? '未知原因'}`,
      )
    } catch (reason) {
      setTestResult(`不可用：${errorText(reason)}`)
    }
  }

  /** Move one quick action up or down; the array order is the bar order. */
  const moveQuickAction = (from: number, to: number): void => {
    setQuickActions(previous => {
      if (to < 0 || to >= previous.length) return previous
      const next = [...previous]
      const [item] = next.splice(from, 1)
      if (item === undefined) return previous
      next.splice(to, 0, item)
      return next
    })
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const actions = quickActions
        .map(action => ({
          label: action.label.trim().slice(0, QUICK_LABEL_MAX),
          prompt: action.prompt.trim().slice(0, QUICK_PROMPT_MAX),
        }))
        .filter(action => action.label.length > 0 && action.prompt.length > 0)
        .slice(0, MAX_QUICK_ACTIONS)
      const value = await post<SettingsView>('/settings', {
        text: {
          kind,
          baseURL,
          model,
          apiKeyEnv,
          temperature: Number(temperature),
          maxTokens: Number(maxTokens),
          timeoutMs: Number(timeoutMs),
          ...(apiKey.trim().length > 0 ? { apiKey } : clearKey ? { apiKey: '' } : {}),
        },
        image: { enabled: caps.image.enabled, baseURL: caps.image.baseURL, model: caps.image.model, apiKeyEnv: caps.image.apiKeyEnv },
        animation: {
          enabled: caps.animation.enabled,
          baseURL: caps.animation.baseURL,
          model: caps.animation.model,
          apiKeyEnv: caps.animation.apiKeyEnv,
          mode: animationMode,
        },
        embedding: {
          enabled: caps.embedding.enabled,
          baseURL: caps.embedding.baseURL,
          model: caps.embedding.model,
          apiKeyEnv: caps.embedding.apiKeyEnv,
        },
        study: {
          targetRetention: Number(targetRetention),
          maxIntervalDays: Number(maxIntervalDays),
          dailyNewUnits: Number(dailyNewUnits),
          autoQuiz,
          verifyNotes,
          quickActions: actions,
          pricing: {
            currency: priceCurrency,
            inputPerMillion: Number(inputPrice) || 0,
            cacheInputPerMillion: Number(cacheInputPrice) || 0,
            outputPerMillion: Number(outputPrice) || 0,
          },
        },
      })
      setView(value)
      setApiKey('')
      setClearKey(false)
      setToast({ message: '设置已保存', tone: 'ok' })
      onSaved()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  if (error !== null && view === null) return <div className="study-empty">无法读取设置：{error}</div>
  if (view === null) return <div className="study-empty">正在读取设置…</div>

  return (
    <Modal title="书桌设置" subtitle="默认复用 DSH 已配置模型；也可以为文本/图片/动画/嵌入分别指定自定义 API。" onClose={onClose} wide>
      <div className="study-settings">
        <section className="study-settings-section">
          <h3>外观</h3>
          <p className="study-muted">只影响书桌这一面，不动外壳别的面板。这个选择存在当前浏览器里。</p>
          <div className="study-segmented">
            {THEME_STEPS.map(step => (
              <button
                key={step.id}
                type="button"
                className={preference === step.id ? 'is-on' : ''}
                onClick={() => applyThemePreference(step.id)}
              >
                {step.label}
              </button>
            ))}
          </div>
          <p className="study-muted">现在是「{themeLabel(preference)}」。</p>
        </section>
        <section className="study-settings-section">
          <h3>文本引擎</h3>
          <p className="study-muted">
            默认直接使用 DSH 当前模型，不需要填 key；自定义 OpenAI 兼容接口用于换模型或换供应商。
            {view.textReady ? ' 当前可用。' : ' 当前不可用，新建目标会回退到对话。'}
          </p>
          <div className="study-segmented">
            <button type="button" className={kind === 'dsh' ? 'is-on' : ''} onClick={() => setKind('dsh')}>
              复用 DSH 模型
            </button>
            <button type="button" className={kind === 'openai-compatible' ? 'is-on' : ''} onClick={() => setKind('openai-compatible')}>
              自定义 OpenAI 兼容
            </button>
          </div>
          {kind === 'openai-compatible' ? (
            <>
              <div className="study-field">
                <label className="study-field-label">Base URL</label>
                <input className="study-input" placeholder="https://api.openai.com/v1" value={baseURL} disabled={busy} onChange={event => setBaseURL(event.target.value)} />
              </div>
              <div className="study-row">
                <div className="study-field">
                  <label className="study-field-label">模型</label>
                  <input className="study-input" placeholder="gpt-4o-mini / deepseek-chat" value={model} disabled={busy} onChange={event => setModel(event.target.value)} />
                </div>
                <div className="study-field">
                  <label className="study-field-label">API Key</label>
                  <input
                    type="password"
                    className="study-input"
                    placeholder={view.text.apiKeySet ? '已保存；留空保持不变' : 'sk-…'}
                    value={apiKey}
                    disabled={busy}
                    onChange={event => {
                      setApiKey(event.target.value)
                      setClearKey(false)
                    }}
                  />
                </div>
              </div>
              <div className="study-row">
                <div className="study-field">
                  <label className="study-field-label">或读环境变量</label>
                  <input className="study-input" placeholder="STUDY_LLM_API_KEY" value={apiKeyEnv} disabled={busy} onChange={event => setApiKeyEnv(event.target.value)} />
                </div>
                <div className="study-field">
                  <label className="study-field-label">超时（毫秒）</label>
                  <input className="study-input" type="number" value={timeoutMs} disabled={busy} onChange={event => setTimeoutMs(event.target.value)} />
                </div>
              </div>
              <div className="study-row">
                <div className="study-field">
                  <label className="study-field-label">temperature</label>
                  <input className="study-input" type="number" step="0.1" value={temperature} disabled={busy} onChange={event => setTemperature(event.target.value)} />
                </div>
                <div className="study-field">
                  <label className="study-field-label">max tokens</label>
                  <input className="study-input" type="number" value={maxTokens} disabled={busy} onChange={event => setMaxTokens(event.target.value)} />
                </div>
              </div>
              {view.text.apiKeySet ? (
                <label className="study-inline-check">
                  <input type="checkbox" checked={clearKey} onChange={event => setClearKey(event.target.checked)} />
                  清除已保存的 key
                </label>
              ) : null}
            </>
          ) : null}
          <div className="study-inline">
            <button type="button" className="study-ghost" onClick={() => void test()}>
              测试已保存配置
            </button>
            {testResult === null ? null : <span className="study-muted">{testResult}</span>}
          </div>
        </section>

        <section className="study-settings-section">
          <h3>可选能力</h3>
          <p className="study-muted">图片/动画/嵌入在后续阶段接入；这里先保存配置，不会影响文本生成。</p>
          {(['image', 'animation', 'embedding'] as const).map(key => (
            <div key={key} className="study-engine-card">
              <label className="study-inline-check">
                <input
                  type="checkbox"
                  checked={caps[key].enabled}
                  onChange={event => setCaps(previous => ({ ...previous, [key]: { ...previous[key], enabled: event.target.checked } }))}
                />
                {key === 'image' ? '图片生成' : key === 'animation' ? '动画生成' : '嵌入 / 语义索引'}
              </label>
              {caps[key].enabled ? (
                <div className="study-row">
                  <div className="study-field">
                    <label className="study-field-label">Base URL</label>
                    <input
                      className="study-input"
                      value={caps[key].baseURL}
                      onChange={event => setCaps(previous => ({ ...previous, [key]: { ...previous[key], baseURL: event.target.value } }))}
                    />
                  </div>
                  <div className="study-field">
                    <label className="study-field-label">模型</label>
                    <input
                      className="study-input"
                      value={caps[key].model}
                      onChange={event => setCaps(previous => ({ ...previous, [key]: { ...previous[key], model: event.target.value } }))}
                    />
                  </div>
                </div>
              ) : null}
              {key === 'animation' && caps.animation.enabled ? (
                <div className="study-field">
                  <label className="study-field-label">动画形式</label>
                  <select className="study-input" value={animationMode} onChange={event => setAnimationMode(event.target.value as 'svg-html' | 'video')}>
                    <option value="svg-html">文生 SVG / HTML（推荐，先接入）</option>
                    <option value="video">任务式视频 API（预留）</option>
                  </select>
                </div>
              ) : null}
            </div>
          ))}
        </section>

        <section className="study-settings-section">
          <h3>用量与费用</h3>
          <p className="study-muted">
            优先使用接口返回的本次金额；没有返回时按下面的单价估算。缓存输入单价填 0 表示按输入单价计算。只统计学习桌页面内生成的调用。
          </p>
          <div className="study-row">
            <div className="study-field">
              <label className="study-field-label">货币</label>
              <select className="study-input" value={priceCurrency} onChange={event => setPriceCurrency(event.target.value as 'USD' | 'CNY')}>
                <option value="USD">美元 $</option>
                <option value="CNY">人民币 ¥</option>
              </select>
            </div>
            <div className="study-field">
              <label className="study-field-label">输入单价 / 百万 token</label>
              <input className="study-input" type="number" min="0" step="0.01" value={inputPrice} onChange={event => setInputPrice(event.target.value)} />
            </div>
            <div className="study-field">
              <label className="study-field-label" title="0 表示按输入单价计算">缓存输入单价 / 百万 token</label>
              <input className="study-input" type="number" min="0" step="0.01" value={cacheInputPrice} onChange={event => setCacheInputPrice(event.target.value)} />
            </div>
            <div className="study-field">
              <label className="study-field-label">输出单价 / 百万 token</label>
              <input className="study-input" type="number" min="0" step="0.01" value={outputPrice} onChange={event => setOutputPrice(event.target.value)} />
            </div>
          </div>
          {usage === null ? null : (
            <>
              <div className="study-usage-summary">
                <div>
                  <span className="study-field-label">总花费</span>
                  <strong>
                    {usage.totals.pricedCalls === 0 && usage.totals.calls > 0
                      ? '未配置单价'
                      : `${usage.totals.unpricedCalls > 0 ? '≈ ' : ''}${formatCost(usage.totals.cost, usage.currency)}`}
                  </strong>
                </div>
                <div>
                  <span className="study-field-label">今天</span>
                  <strong>
                    {usage.today.pricedCalls === 0 && usage.today.calls > 0
                      ? '未配置单价'
                      : `${usage.today.unpricedCalls > 0 ? '≈ ' : ''}${formatCost(usage.today.cost, usage.currency)}`}
                  </strong>
                </div>
                <div>
                  <span className="study-field-label">累计调用</span>
                  <strong>{usage.totals.calls} 次</strong>
                </div>
                <div>
                  <span className="study-field-label">Token</span>
                  <strong>
                    {formatTokens(usage.totals.inputTokens)} 输入
                    {usage.totals.cacheReadTokens > 0 ? ` / ${formatTokens(usage.totals.cacheReadTokens)} 缓存` : ''}
                    {' / '}{formatTokens(usage.totals.outputTokens)} 输出
                  </strong>
                </div>
              </div>
              <UsageHeatmap days={usage.days} currency={usage.currency} />
            </>
          )}
        </section>

        <section className="study-settings-section">
          <h3>学习与复习</h3>
          <div className="study-row">
            <div className="study-field">
              <label className="study-field-label">目标记忆率</label>
              <input className="study-input" type="number" step="0.01" min="0.5" max="0.99" value={targetRetention} onChange={event => setTargetRetention(event.target.value)} />
            </div>
            <div className="study-field">
              <label className="study-field-label">最大间隔（天）</label>
              <input className="study-input" type="number" value={maxIntervalDays} onChange={event => setMaxIntervalDays(event.target.value)} />
            </div>
            <div className="study-field">
              <label className="study-field-label">每日新学上限（0=不限，预留）</label>
              <input className="study-input" type="number" min="0" value={dailyNewUnits} onChange={event => setDailyNewUnits(event.target.value)} />
            </div>
          </div>
          <div className="study-settings-toggles">
            <label className="study-inline-check">
              <input type="checkbox" checked={autoQuiz} onChange={event => setAutoQuiz(event.target.checked)} />
              生成导读后自动出题
            </label>
            <label className="study-inline-check">
              <input type="checkbox" checked={verifyNotes} onChange={event => setVerifyNotes(event.target.checked)} />
              写完后做一次独立校验（后续阶段）
            </label>
          </div>
        </section>

        <section className="study-settings-section">
          <h3>划词动作</h3>
          <p className="study-muted">
            选中文字后，这些按钮按下面的顺序排在「问一问」前面，点一下就会带着选中的原文直接执行。最多 {MAX_QUICK_ACTIONS}
            个；「问一问」固定排在最后。
          </p>
          {quickActions.map((action, index) => (
            <div className="study-quick-action" key={index}>
              <div className="study-row">
                <div className="study-field study-quick-action-name">
                  <label className="study-field-label">按钮名</label>
                  <input
                    className="study-input"
                    maxLength={QUICK_LABEL_MAX}
                    placeholder="翻译"
                    value={action.label}
                    disabled={busy}
                    onChange={event =>
                      setQuickActions(previous =>
                        previous.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)),
                      )
                    }
                  />
                </div>
                <div className="study-field">
                  <label className="study-field-label">指令</label>
                  <input
                    className="study-input"
                    maxLength={QUICK_PROMPT_MAX}
                    placeholder="把这段翻成中文，保留术语和公式，不要总结。"
                    value={action.prompt}
                    disabled={busy}
                    onChange={event =>
                      setQuickActions(previous =>
                        previous.map((item, at) => (at === index ? { ...item, prompt: event.target.value } : item)),
                      )
                    }
                  />
                </div>
                <div className="study-quick-action-tools">
                  <button
                    type="button"
                    className="study-ghost study-quick-action-move"
                    title="上移"
                    aria-label="上移"
                    disabled={busy || index === 0}
                    onClick={() => moveQuickAction(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="study-ghost study-quick-action-move"
                    title="下移"
                    aria-label="下移"
                    disabled={busy || index === quickActions.length - 1}
                    onClick={() => moveQuickAction(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="study-ghost study-quick-action-remove"
                    disabled={busy}
                    onClick={() => setQuickActions(previous => previous.filter((_, at) => at !== index))}
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="study-inline">
            <button
              type="button"
              className="study-ghost"
              disabled={busy || quickActions.length >= MAX_QUICK_ACTIONS}
              onClick={() => setQuickActions(previous => [...previous, { label: '', prompt: '' }])}
            >
              加一个
            </button>
            <span className="study-muted">例子：翻译成中文 / 用一句话解释 / 找出这段的隐含假设</span>
          </div>
          <p className="study-quick-preview">
            划词后会看到：
            {quickActions
              .filter(action => action.label.trim().length > 0)
              .map((action, index) => (
                <span key={`${String(index)}:${action.label}`} className="study-quick-chip">
                  {action.label.trim()}
                </span>
              ))}
            <span className="study-quick-chip is-ask">问一问</span>
          </p>
        </section>

        {error === null ? null : <ErrorNote message={error} />}
        <div className="study-modal-actions">
          <button type="button" className="study-ghost" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </Modal>
  )
}
