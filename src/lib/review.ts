// Turns per-position engine evaluations into a game review: move labels,
// accuracy and an eval curve. Win-chance and accuracy formulas follow the
// published Lichess model; label thresholds use expected-points loss.
import { Chess, type Square } from 'chess.js'
import type { PositionAnalysis, Score } from './engine'

export type Color = 'w' | 'b'

export type Ply = {
  san: string
  uci: string
  from: string
  to: string
  color: Color
  piece: string
  captured?: string
  promotion?: string
  fenBefore: string
  fenAfter: string
  moveNumber: number
}

export type ParsedGame = {
  headers: Record<string, string>
  startFen: string
  plies: Ply[]
  fens: string[] // startFen followed by the position after each ply
}

export function parseGame(pgn: string): ParsedGame {
  const chess = new Chess()
  chess.loadPgn(pgn)
  return gameFromChess(chess)
}

/** Builds the move-by-move view of a game from a chess.js instance. */
export function gameFromChess(chess: Chess): ParsedGame {
  const history = chess.history({ verbose: true })
  const startFen = history[0]?.before ?? chess.fen()
  const plies = history.map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    from: m.from,
    to: m.to,
    color: m.color,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    fenBefore: m.before,
    fenAfter: m.after,
    moveNumber: Number(m.before.split(' ')[5]),
  }))
  return { headers: chess.getHeaders(), startFen, plies, fens: [startFen, ...plies.map((p) => p.fenAfter)] }
}

/** Score for a position the engine should not search (mate / stalemate / dead draw). */
export function terminalScore(fen: string): Score | undefined {
  const c = new Chess(fen)
  if (c.isCheckmate()) return { type: 'over', result: c.turn() === 'w' ? '0-1' : '1-0' }
  if (c.isStalemate() || c.isInsufficientMaterial()) return { type: 'over', result: '1/2-1/2' }
  return undefined
}

export function evalOf(a: PositionAnalysis): Score | undefined {
  return a.terminal ?? a.lines[0]?.score
}

/** White's winning chance, 0..100. */
export function winPercent(s: Score): number {
  if (s.type === 'over') return s.result === '1-0' ? 100 : s.result === '0-1' ? 0 : 50
  if (s.type === 'mate') return s.value > 0 ? 100 : 0
  const cp = Math.max(-1000, Math.min(1000, s.value))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function formatScore(s: Score | undefined): string {
  if (!s) return '…'
  if (s.type === 'over') return s.result === '1/2-1/2' ? '½-½' : s.result
  if (s.type === 'mate') return `${s.value > 0 ? '' : '-'}M${Math.abs(s.value)}`
  const v = s.value / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}

function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (winBefore - winAfter)) - 3.166924740191411
  return Math.max(0, Math.min(100, raw + 1))
}

export type Label =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

export const LABELS: Label[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder']

export type MoveReview = {
  ply: Ply
  label: Label
  winBefore: number // mover's point of view
  winAfter: number
  accuracy: number
  bestUci?: string
  bestSan?: string
  scoreAfter: Score
}

export type GameReview = {
  moves: (MoveReview | null)[] // null until both surrounding positions are analyzed
  whiteWin: (number | null)[] // per position, for the eval graph
  accuracy: { w: number | null; b: number | null }
  counts: { w: Record<Label, number>; b: Record<Label, number> }
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/**
 * A move gives up material when the moved piece can be taken by a cheaper piece,
 * or taken without being defended, and it did not capture something worth as much.
 */
function isSacrifice(ply: Ply): boolean {
  if (ply.piece === 'p' || ply.piece === 'k' || ply.promotion) return false
  const moved = VALUE[ply.piece]
  const gained = ply.captured ? VALUE[ply.captured] : 0
  if (gained >= moved) return false
  const after = new Chess(ply.fenAfter)
  const takers = after.moves({ verbose: true }).filter((m) => m.to === ply.to && m.captured)
  if (takers.length === 0) return false
  const cheapest = Math.min(...takers.map((m) => VALUE[m.piece]))
  const defended = after.attackers(ply.to as Square, ply.color).length > 0
  return cheapest < moved - gained || !defended
}

function uciToSan(fen: string, uci: string): string | undefined {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
  } catch {
    return undefined
  }
}

function labelByLoss(loss: number): Label {
  if (loss < 2) return 'excellent'
  if (loss < 5) return 'good'
  if (loss < 10) return 'inaccuracy'
  if (loss < 20) return 'mistake'
  return 'blunder'
}

export function buildReview(game: ParsedGame, analyses: (PositionAnalysis | undefined)[]): GameReview {
  const whiteWin = game.fens.map((_, i) => {
    const a = analyses[i]
    const s = a && evalOf(a)
    return s ? winPercent(s) : null
  })

  const moves: (MoveReview | null)[] = game.plies.map((ply, i) => {
    const pre = analyses[i]
    const post = analyses[i + 1]
    const preScore = pre && evalOf(pre)
    const postScore = post && evalOf(post)
    if (!pre || !preScore || !postScore) return null
    const pov = (w: number) => (ply.color === 'w' ? w : 100 - w)
    const winBefore = pov(winPercent(preScore))
    const winAfter = pov(winPercent(postScore))
    const loss = Math.max(0, winBefore - winAfter)
    const bestUci = pre.lines[0]?.pv[0]
    const isBest = bestUci === ply.uci

    let label: Label = isBest ? 'best' : labelByLoss(loss)
    if (isBest && winBefore < 97) {
      const second = pre.lines[1]
      const onlyMove = second && winBefore - pov(winPercent(second.score)) >= 15
      // Winning material back right after the opponent took some is forced, not great.
      const recapture = ply.captured !== undefined && game.plies[i - 1]?.captured !== undefined
      if (winAfter >= 50 && isSacrifice(ply)) label = 'brilliant'
      else if (onlyMove && !recapture) label = 'great'
    }
    return {
      ply,
      label,
      winBefore,
      winAfter,
      accuracy: moveAccuracy(winBefore, winAfter),
      bestUci,
      bestSan: bestUci ? uciToSan(ply.fenBefore, bestUci) : undefined,
      scoreAfter: postScore,
    }
  })

  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1]
    const cur = moves[i]
    if (!prev || !cur) continue
    const opened = prev.label === 'mistake' || prev.label === 'blunder' || prev.label === 'miss'
    // Grabbing material the opponent just left hanging is best, not great.
    if (opened && cur.label === 'great' && cur.ply.captured) cur.label = 'best'
    // "Miss": the opponent just erred and this move handed most of it back.
    if (!opened || !['inaccuracy', 'mistake', 'blunder'].includes(cur.label)) continue
    const before = 100 - prev.winBefore // this player's chances before the opponent's error
    if (cur.winBefore - cur.winAfter >= 10 && cur.winAfter >= before - 5) cur.label = 'miss'
  }

  return { moves, whiteWin, accuracy: gameAccuracy(whiteWin, moves), counts: countLabels(moves) }
}

function countLabels(moves: (MoveReview | null)[]) {
  const empty = () => Object.fromEntries(LABELS.map((l) => [l, 0])) as Record<Label, number>
  const counts = { w: empty(), b: empty() }
  for (const m of moves) if (m) counts[m.ply.color][m.label]++
  return counts
}

function stdDev(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

/**
 * Lichess game accuracy: the average of a volatility-weighted mean and a
 * harmonic mean of per-move accuracy, so calm stretches count less and a
 * single blunder still hurts.
 */
function gameAccuracy(whiteWin: (number | null)[], moves: (MoveReview | null)[]) {
  const result = { w: null as number | null, b: null as number | null }
  if (moves.length === 0 || moves.some((m) => !m) || whiteWin.some((w) => w === null)) return result
  const wins = whiteWin as number[]
  const size = Math.max(2, Math.min(8, Math.floor(moves.length / 10)))
  const windows: number[][] = Array.from({ length: Math.max(0, Math.min(size, wins.length) - 2) }, () =>
    wins.slice(0, size),
  )
  for (let i = 0; i + size <= wins.length; i++) windows.push(wins.slice(i, i + size))
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))))

  for (const color of ['w', 'b'] as const) {
    let weighted = 0
    let weightTotal = 0
    let inverse = 0
    let n = 0
    moves.forEach((m, i) => {
      if (!m || m.ply.color !== color) return
      const weight = weights[i] ?? 0.5
      weighted += m.accuracy * weight
      weightTotal += weight
      inverse += 1 / Math.max(m.accuracy, 1)
      n++
    })
    if (n > 0) result[color] = (weighted / weightTotal + n / inverse) / 2
  }
  return result
}
