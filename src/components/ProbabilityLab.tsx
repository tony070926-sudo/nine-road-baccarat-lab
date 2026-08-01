import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PROBABILITY_LAB_SEED,
  PROBABILITY_LAB_ROUND_OPTIONS,
  type ProbabilityLabReport,
  type ProbabilityLabRoundCount,
  type ProbabilityMetricName,
  type ProbabilityWorkerRequest,
  type ProbabilityWorkerResponse,
} from '../game/probabilityLab'

export interface ProbabilityWorkerPort {
  onmessage: ((event: MessageEvent<ProbabilityWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (message: ProbabilityWorkerRequest) => void
  terminate: () => void
}

interface ProbabilityLabProps {
  initialRounds?: ProbabilityLabRoundCount
  seed?: number
  workerFactory?: () => ProbabilityWorkerPort
}

type LabStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'error'

const METRIC_LABELS: Record<ProbabilityMetricName, string> = {
  banker: '庄胜',
  player: '闲胜',
  tie: '和局',
  playerPair: '闲对',
  bankerPair: '庄对',
}

let requestCounter = 0

function defaultWorkerFactory(): ProbabilityWorkerPort {
  if (typeof Worker !== 'function') {
    throw new Error('当前浏览器不支持 Web Worker，概率实验未运行。')
  }
  return new Worker(
    new URL('../workers/probability.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(4)}%`
}

export function ProbabilityLab({
  initialRounds = 1_000,
  seed = DEFAULT_PROBABILITY_LAB_SEED,
  workerFactory = defaultWorkerFactory,
}: ProbabilityLabProps) {
  const [rounds, setRounds] =
    useState<ProbabilityLabRoundCount>(initialRounds)
  const [status, setStatus] = useState<LabStatus>('idle')
  const [report, setReport] = useState<ProbabilityLabReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<ProbabilityWorkerPort | null>(null)
  const activeRequestRef = useRef<string | null>(null)

  const stopWorker = () => {
    workerRef.current?.terminate()
    workerRef.current = null
    activeRequestRef.current = null
  }

  useEffect(() => () => stopWorker(), [])

  const run = () => {
    stopWorker()
    setError(null)
    setReport(null)

    let worker: ProbabilityWorkerPort
    try {
      worker = workerFactory()
    } catch (workerError) {
      setStatus('error')
      setError(
        workerError instanceof Error
          ? workerError.message
          : '概率实验 Worker 无法启动。',
      )
      return
    }

    requestCounter += 1
    const requestId = `probability-lab-${requestCounter}`
    activeRequestRef.current = requestId
    workerRef.current = worker
    setStatus('running')

    worker.onmessage = (event) => {
      const response = event.data
      if (response.requestId !== activeRequestRef.current) return
      stopWorker()
      if (response.type === 'result') {
        setReport(response.report)
        setStatus('complete')
      } else {
        setError(response.message)
        setStatus('error')
      }
    }
    worker.onerror = () => {
      if (activeRequestRef.current !== requestId) return
      stopWorker()
      setError('概率实验 Worker 运行失败；牌局与历史记录未受影响。')
      setStatus('error')
    }

    try {
      worker.postMessage({
        type: 'run',
        requestId,
        rounds,
        seed: seed >>> 0,
      })
    } catch (postError) {
      stopWorker()
      setError(
        postError instanceof Error ? postError.message : '概率实验请求发送失败。',
      )
      setStatus('error')
    }
  }

  const cancel = () => {
    if (status !== 'running') return
    stopWorker()
    setStatus('cancelled')
    setError(null)
  }

  return (
    <section
      className="probability-lab"
      data-probability-lab="true"
      data-lab-status={status}
      aria-label="八副牌概率实验室"
    >
      <header>
        <strong>八副牌概率实验室</strong>
        <small>使用独立牌靴与固定规则，不读取或写入正式牌局</small>
      </header>

      <div role="group" aria-label="选择实验局数">
        {PROBABILITY_LAB_ROUND_OPTIONS.map((option) => (
          <button
            type="button"
            key={option}
            onClick={() => setRounds(option)}
            aria-pressed={rounds === option}
            disabled={status === 'running'}
          >
            {option.toLocaleString('zh-CN')} 局
          </button>
        ))}
      </div>

      <div className="probability-lab-actions">
        <button type="button" onClick={run}>
          {status === 'idle' ? '开始实验' : '重新运行'}
        </button>
        <button type="button" onClick={cancel} disabled={status !== 'running'}>
          取消
        </button>
      </div>

      <p role="status">
        {status === 'idle' && '请选择 100、1,000 或 10,000 局。'}
        {status === 'running' && `正在独立模拟 ${rounds.toLocaleString('zh-CN')} 局…`}
        {status === 'cancelled' && '实验已取消；没有改动牌靴、余额或历史记录。'}
        {status === 'complete' && `已完成 ${report?.rounds.toLocaleString('zh-CN')} 局。`}
      </p>

      {error && <p role="alert">{error}</p>}

      {report && (
        <div className="probability-lab-report" data-lab-report="true">
          <table>
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">实际</th>
                <th scope="col">理论</th>
                <th scope="col">绝对偏差</th>
                <th scope="col">95% 置信区间</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(METRIC_LABELS) as ProbabilityMetricName[]).map(
                (name) => {
                  const metric = report.metrics[name]
                  return (
                    <tr key={name}>
                      <th scope="row">{METRIC_LABELS[name]}</th>
                      <td>{percentage(metric.observed)}</td>
                      <td>{percentage(metric.theoretical)}</td>
                      <td>{percentage(metric.absoluteDeviation)}</td>
                      <td>
                        {percentage(metric.confidence95.lower)}–
                        {percentage(metric.confidence95.upper)}
                      </td>
                    </tr>
                  )
                },
              )}
            </tbody>
          </table>
          <p>{report.houseEdgeSummary}</p>
          <ul>
            {Object.values(report.houseEdges).map((item) => (
              <li key={item.explanation}>{item.explanation}</li>
            ))}
          </ul>
          <small>
            种子 {report.seed ?? '外部注入'} · {report.shoes} 靴 · 结果仅保存在当前组件内存
          </small>
        </div>
      )}
    </section>
  )
}
