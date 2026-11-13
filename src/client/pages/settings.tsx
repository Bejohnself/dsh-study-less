/**
 * Settings: generation engines, study preferences and the text-engine test.
 *
 * Secrets never travel back from the Host: the form only knows whether a key is
 * stored, and an empty field means "keep the existing one".
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { SettingsView } from '../../core/views.ts'
import { api, errorText, post } from '../api.ts'
import { ErrorNote, Modal, Toast } from '../components/ui.tsx'

type CapabilityKey = 'image' | 'animation' | 'embedding'

/** The settings modal. */
export function SettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): ReactElement {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

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

  const [targetRetention, setTargetRetention] = useState('0.9')
  const [maxIntervalDays, setMaxIntervalDays] = useState('365')
  const [dailyNewUnits, setDailyNewUnits] = useState('0')
  const [autoQuiz, setAutoQuiz] = useState(true)
  const [autoInsight, setAutoInsight] = useState(true)
  const [verifyNotes, setVerifyNotes] = useState(false)

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
        setTargetRetention(String(value.study.targetRetention))
        setMaxIntervalDays(String(value.study.maxIntervalDays))
        setDailyNewUnits(String(value.study.dailyNewUnits))
        setAutoQuiz(value.study.autoQuiz)
        setAutoInsight(value.study.autoInsight)
        setVerifyNotes(value.study.verifyNotes)
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

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
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
          autoInsight,
          verifyNotes,
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
              <label className="study-field-label">每日新学上限（0=不限）</label>
              <input className="study-input" type="number" min="0" value={dailyNewUnits} onChange={event => setDailyNewUnits(event.target.value)} />
            </div>
          </div>
          <div className="study-settings-toggles">
            <label className="study-inline-check">
              <input type="checkbox" checked={autoQuiz} onChange={event => setAutoQuiz(event.target.checked)} />
              生成精读后自动出题
            </label>
            <label className="study-inline-check">
              <input type="checkbox" checked={autoInsight} onChange={event => setAutoInsight(event.target.checked)} />
              生成精读后自动提炼洞察
            </label>
            <label className="study-inline-check">
              <input type="checkbox" checked={verifyNotes} onChange={event => setVerifyNotes(event.target.checked)} />
              写完后做一次独立校验（后续阶段）
            </label>
          </div>
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
