// Thin UCI wrapper around the Stockfish WASM worker. Requests are serialized:
// the worker can only search one position at a time.

/** Evaluation from White's point of view. */
export type Score =
  | { type: 'cp'; value: number }
  | { type: 'mate'; value: number } // moves to mate; positive = White mates
  | { type: 'over'; result: '1-0' | '0-1' | '1/2-1/2' }

export type Line = { score: Score; pv: string[] }

export type PositionAnalysis = {
  depth: number
  lines: Line[] // best first; empty for finished positions
  terminal?: Score
}

export type EngineOptions = Record<string, string | number | boolean>

export class Engine {
  private worker: Worker
  private listener: ((line: string) => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: EngineOptions, url = `${import.meta.env.BASE_URL}engine/stockfish.js`) {
    this.worker = new Worker(url)
    this.worker.onmessage = (e) => this.listener?.(String(e.data))
    this.enqueue(async () => {
      const uciok = this.waitFor((l) => l === 'uciok')
      this.send('uci')
      await uciok
      await this.applyOptions(options)
    })
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  private waitFor(match: (line: string) => boolean) {
    return new Promise<void>((resolve) => {
      this.listener = (line) => {
        if (match(line)) {
          this.listener = null
          resolve()
        }
      }
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async applyOptions(options: EngineOptions) {
    for (const [name, value] of Object.entries(options)) this.send(`setoption name ${name} value ${value}`)
    const readyok = this.waitFor((l) => l === 'readyok')
    this.send('isready')
    await readyok
  }

  /** Changes engine options before the next queued search. */
  configure(options: EngineOptions): Promise<void> {
    return this.enqueue(() => this.applyOptions(options))
  }

  /** Searches to a fixed depth and returns every principal variation. */
  analyze(fen: string, depth: number): Promise<PositionAnalysis> {
    const whiteToMove = fen.split(' ')[1] === 'w'
    return this.enqueue(async () => {
      const lines = new Map<number, Line>()
      let reached = 0
      const done = new Promise<void>((resolve) => {
        this.listener = (line) => {
          if (line.startsWith('bestmove')) {
            this.listener = null
            resolve()
            return
          }
          const info = parseInfo(line, whiteToMove)
          if (info) {
            lines.set(info.multipv, { score: info.score, pv: info.pv })
            reached = Math.max(reached, info.depth)
          }
        }
      })
      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
      await done
      return {
        depth: reached,
        lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l),
      }
    })
  }

  /** Lets the engine pick a move under its current options; null if there is none. */
  bestMove(fen: string, limit: { depth?: number; movetime?: number }): Promise<string | null> {
    return this.enqueue(async () => {
      let move: string | null = null
      const done = new Promise<void>((resolve) => {
        this.listener = (line) => {
          if (!line.startsWith('bestmove')) return
          this.listener = null
          const uci = line.split(' ')[1]
          move = uci && uci !== '(none)' ? uci : null
          resolve()
        }
      })
      this.send(`position fen ${fen}`)
      this.send(limit.depth ? `go depth ${limit.depth}` : `go movetime ${limit.movetime ?? 500}`)
      await done
      return move
    })
  }

  /** Ends the current search early; its promise still resolves. */
  stop() {
    this.send('stop')
  }
}

function parseInfo(line: string, whiteToMove: boolean) {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null
  if (line.includes(' lowerbound') || line.includes(' upperbound')) return null
  const t = line.split(' ')
  const at = (key: string) => t.indexOf(key)
  const scoreAt = at('score')
  if (scoreAt < 0) return null
  const sign = whiteToMove ? 1 : -1
  const kind = t[scoreAt + 1]
  const raw = Number(t[scoreAt + 2])
  const score: Score =
    kind === 'mate' ? { type: 'mate', value: raw * sign } : { type: 'cp', value: raw * sign }
  return {
    depth: Number(t[at('depth') + 1]),
    multipv: at('multipv') >= 0 ? Number(t[at('multipv') + 1]) : 1,
    score,
    pv: t.slice(at('pv') + 1),
  }
}

// One worker per job, so a background review never delays the bot or the coach.
const instances: Partial<Record<'review' | 'coach' | 'bot', Engine>> = {}
const ANALYSIS: EngineOptions = { Hash: 32, MultiPV: 2 }

export const reviewEngine = () => (instances.review ??= new Engine(ANALYSIS))
export const coachEngine = () => (instances.coach ??= new Engine(ANALYSIS))
export const botEngine = () => (instances.bot ??= new Engine({ Hash: 16, MultiPV: 1 }))
