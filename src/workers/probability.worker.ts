import {
  runProbabilityLab,
  type ProbabilityWorkerRequest,
  type ProbabilityWorkerResponse,
} from '../game/probabilityLab'

interface ProbabilityWorkerScope {
  onmessage: ((event: MessageEvent<ProbabilityWorkerRequest>) => void) | null
  postMessage: (message: ProbabilityWorkerResponse) => void
}

const workerScope = globalThis as unknown as ProbabilityWorkerScope

workerScope.onmessage = (event) => {
  const request = event.data
  if (request.type !== 'run') return

  try {
    const report = runProbabilityLab({
      rounds: request.rounds,
      seed: request.seed,
    })
    workerScope.postMessage({
      type: 'result',
      requestId: request.requestId,
      report,
    })
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : '概率实验运行失败',
    })
  }
}
