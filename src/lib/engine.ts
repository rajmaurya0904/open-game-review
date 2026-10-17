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

export class Engine {
  private worker: Worker
  private listener: ((line: string) => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private ready: Promise<void>

  constructor(url = `${import.meta.env.BASE_URL}engine/stockfish.js`) {
    this.worker = new Worker(url)
    this.worker.onmessage = (e) => this.listener?.(String(e.data))
    this.ready = this.init()
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

  private async init() {
    const uciok = this.waitFor((l) => l === 'uciok')
    this.send('uci')
    await uciok
    this.send('setoption name Hash value 32')
    this.send('setoption name MultiPV value 2')
    const readyok = this.waitFor((l) => l === 'readyok')
    this.send('isready')
    await readyok
  }

  analyze(fen: string, depth: number): Promise<PositionAnalysis> {
    const whiteToMove = fen.split(' ')[1] === 'w'
    const run = async (): Promise<PositionAnalysis> => {
      await this.ready
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
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
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
