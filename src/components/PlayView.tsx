import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { PlayBoard } from './PlayBoard'
import { MoveList } from './MoveList'
import { Summary } from './Summary'
import { EvalGraph } from './EvalGraph'
import { BOT_LEVELS, chooseBotMove, stopBot } from '../lib/bot'
import { coachEngine, type PositionAnalysis } from '../lib/engine'
import { describeMove, LABEL_META } from '../lib/labels'
import { buildReview, evalOf, formatScore, gameFromChess, terminalScore, winPercent, type Color } from '../lib/review'

const COACH_DEPTH = 12
const MIN_BOT_THINK_MS = 450

const CLOCKS = [
  { label: 'No clock', initial: 0, increment: 0 },
  { label: '5 min', initial: 5 * 60_000, increment: 0 },
  { label: '10 min', initial: 10 * 60_000, increment: 0 },
  { label: '15 | 10', initial: 15 * 60_000, increment: 10_000 },
]

type Settings = { level: number; color: Color | 'random'; clock: number; coach: boolean }
type Status = 'setup' | 'playing' | 'over'
type Result = { winner: Color | null; reason: string }
type Clocks = { w: number; b: number }
type Saved = { settings: Settings; status: Status; player: Color; moves: string[]; result: Result | null; clocks: Clocks | null }

const SAVE_KEY = 'ogr:play'
const SETTINGS_KEY = 'ogr:play-settings'
const DEFAULT_SETTINGS: Settings = { level: 4, color: 'w', clock: 0, coach: true }

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the game just won't survive a reload.
  }
}

const moverAt = (i: number): Color => (i % 2 === 0 ? 'w' : 'b') // games always start from the initial position
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')

function replay(moves: string[]) {
  const c = new Chess()
  for (const m of moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })
  return c
}

function outcome(c: Chess): Result | null {
  if (c.isCheckmate()) return { winner: other(c.turn()), reason: 'checkmate' }
  if (c.isStalemate()) return { winner: null, reason: 'stalemate' }
  if (c.isInsufficientMaterial()) return { winner: null, reason: 'insufficient material' }
  if (c.isThreefoldRepetition()) return { winner: null, reason: 'repetition' }
  if (c.isDrawByFiftyMoves()) return { winner: null, reason: 'the 50-move rule' }
  return null
}

function formatClock(ms: number) {
  const t = Math.max(0, ms)
  const m = Math.floor(t / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  if (t < 10_000) return `0:${String(s).padStart(2, '0')}.${Math.floor((t % 1000) / 100)}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PlayView({ onReview }: { onReview: (pgn: string) => void }) {
  const [saved] = useState(() => load<Saved>(SAVE_KEY))
  const [settings, setSettings] = useState<Settings>(
    () => saved?.settings ?? { ...DEFAULT_SETTINGS, ...load<Settings>(SETTINGS_KEY) },
  )
  const [status, setStatus] = useState<Status>(saved?.status ?? 'setup')
  const [player, setPlayer] = useState<Color>(saved?.player ?? 'w')
  const [moves, setMoves] = useState<string[]>(saved?.moves ?? [])
  const [result, setResult] = useState<Result | null>(saved?.result ?? null)
  const [clocks, setClocks] = useState<Clocks | null>(saved?.clocks ?? null)
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
  const [hint, setHint] = useState(0)
  const [thinking, setThinking] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [analyses, setAnalyses] = useState<Record<string, PositionAnalysis>>({})

  const chess = useMemo(() => replay(moves), [moves])
  const game = useMemo(() => gameFromChess(chess), [chess])
  const level = BOT_LEVELS[settings.level]
  const turn = chess.turn()
  const myTurn = status === 'playing' && turn === player
  const clockSetting = CLOCKS[settings.clock]

  useEffect(() => save(SETTINGS_KEY, settings), [settings])
  useEffect(() => {
    save(SAVE_KEY, status === 'setup' ? null : { settings, status, player, moves, result, clocks })
  }, [settings, status, player, moves, result, clocks])

  const applyMove = (uci: string) => {
    const at = Date.now()
    const mover = moverAt(moves.length)
    if (clocks) {
      setClocks({ ...clocks, [mover]: Math.max(0, clocks[mover] - (at - turnStartedAt)) + clockSetting.increment })
    }
    setMoves([...moves, uci])
    setTurnStartedAt(at)
    setHint(0)
    setSelected(null)
  }

  // Game end by the rules.
  useEffect(() => {
    if (status !== 'playing') return
    const r = outcome(chess)
    if (r) {
      setStatus('over')
      setResult(r)
    }
  }, [chess, status])

  // The bot's turn. Its move lands asynchronously, so it goes through a ref
  // that always holds the latest applyMove.
  const applyRef = useRef(applyMove)
  useEffect(() => {
    applyRef.current = applyMove
  })
  useEffect(() => {
    if (status !== 'playing' || chess.turn() === player || outcome(chess)) return
    let cancelled = false
    const started = Date.now()
    setThinking(true)
    chooseBotMove(chess.fen(), level)
      .then(async (uci) => {
        const wait = MIN_BOT_THINK_MS - (Date.now() - started)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        if (!cancelled && uci) applyRef.current(uci)
      })
      .finally(() => {
        if (!cancelled) setThinking(false)
      })
    return () => {
      cancelled = true
      stopBot()
      setThinking(false)
    }
  }, [chess, status, player, level])

  // Clock ticks and flag fall.
  useEffect(() => {
    if (status !== 'playing' || !clocks) return
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (clocks[turn] - (t - turnStartedAt) <= 0) {
        setClocks({ ...clocks, [turn]: 0 })
        setStatus('over')
        setResult({ winner: other(turn), reason: 'time' })
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [status, clocks, turn, turnStartedAt])

  // Coach: analyze every position at full strength, newest first, reusing earlier results.
  const fensRef = useRef<string[]>([])
  const known = useRef<Record<string, PositionAnalysis>>({})
  const busy = useRef(false)
  const pump = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      for (;;) {
        const fen = [...fensRef.current].reverse().find((f) => !known.current[f])
        if (!fen) break
        const terminal = terminalScore(fen)
        known.current[fen] = terminal ? { depth: 0, lines: [], terminal } : await coachEngine().analyze(fen, COACH_DEPTH)
        setAnalyses({ ...known.current })
      }
    } finally {
      busy.current = false
    }
  }, [])
  useEffect(() => {
    fensRef.current = game.fens
    pump()
  }, [game, pump])

  const review = useMemo(() => buildReview(game, game.fens.map((f) => analyses[f])), [game, analyses])
  const showCoach = settings.coach || status === 'over'
  const shownReview = useMemo(
    () => (showCoach ? review : { ...review, moves: review.moves.map(() => null) }),
    [review, showCoach],
  )

  const start = () => {
    const color = settings.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color
    setPlayer(color)
    setMoves([])
    setResult(null)
    setStatus('playing')
    setClocks(clockSetting.initial ? { w: clockSetting.initial, b: clockSetting.initial } : null)
    setTurnStartedAt(Date.now())
    setHint(0)
    setSelected(null)
    setFlipped(false)
  }

  const newGame = () => {
    if (status === 'playing' && moves.length > 0 && !window.confirm('Abandon this game?')) return
    setStatus('setup')
    setMoves([])
    setResult(null)
    setClocks(null)
  }

  const canTakeBack =
    moves.some((_, i) => moverAt(i) === player) &&
    (status === 'playing' || (status === 'over' && result?.reason !== 'resignation' && result?.reason !== 'time'))

  const takeBack = () => {
    if (!canTakeBack) return
    let i = moves.length - 1
    while (i >= 0 && moverAt(i) !== player) i--
    setMoves(moves.slice(0, i))
    setStatus('playing')
    setResult(null)
    setTurnStartedAt(Date.now())
    setHint(0)
    setSelected(null)
  }

  const resign = () => {
    if (status !== 'playing' || !window.confirm('Resign this game?')) return
    setStatus('over')
    setResult({ winner: other(player), reason: 'resignation' })
  }

  const tryMove = (from: string, to: string) => {
    if (!myTurn) return false
    try {
      const m = new Chess(chess.fen()).move({ from, to, promotion: 'q' })
      applyMove(m.from + m.to + (m.promotion ?? ''))
      return true
    } catch {
      return false
    }
  }

  const onSquareClick = (square: string) => {
    if (!myTurn) return
    if (selected && selected !== square && tryMove(selected, square)) return
    const piece = chess.get(square as Parameters<Chess['get']>[0])
    setSelected(piece && piece.color === player && square !== selected ? square : null)
  }

  const targets = selected
    ? chess
        .moves({ square: selected as Parameters<Chess['get']>[0], verbose: true })
        .map((m) => ({ square: m.to, capture: Boolean(m.captured) }))
    : []

  const exportPgn = () => {
    const c = replay(moves)
    const botName = `Stockfish (${level.name})`
    const res = result ? (result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '1/2-1/2') : '*'
    c.setHeader('Event', 'Play vs Bot')
    c.setHeader('Site', 'Open Game Review')
    c.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'))
    c.setHeader('White', player === 'w' ? 'You' : botName)
    c.setHeader('Black', player === 'b' ? 'You' : botName)
    c.setHeader(player === 'w' ? 'BlackElo' : 'WhiteElo', String(level.rating))
    c.setHeader('Result', res)
    if (result) c.setHeader('Termination', result.reason)
    return c.pgn()
  }

  // Derived view state.
  const here = analyses[chess.fen()]
  const hereScore = here && evalOf(here)
  const best = here?.lines[0]?.pv[0]
  const lastIndex = moves.length - 1
  const lastPly = lastIndex >= 0 ? game.plies[lastIndex] : null
  const lastReview = lastIndex >= 0 ? shownReview.moves[lastIndex] : null
  const lastMeta = lastReview ? LABEL_META[lastReview.label] : null

  let myLast = -1
  for (let i = moves.length - 1; i >= 0; i--) if (moverAt(i) === player) { myLast = i; break }
  const myReview = myLast >= 0 ? review.moves[myLast] : null
  const myPly = myLast >= 0 ? game.plies[myLast] : null

  const arrows = []
  if (myTurn && hint === 2 && best) arrows.push({ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: 'rgba(79,143,216,0.85)' })

  const orientation = (player === 'w') !== flipped ? 'white' : 'black'
  const remaining = (c: Color) =>
    clocks ? (status === 'playing' && turn === c ? clocks[c] - (now - turnStartedAt) : clocks[c]) : null

  const botSide = other(player)
  const strip = (side: Color) => {
    const isBot = side === botSide
    const ms = remaining(side)
    return (
      <div className="player-strip play">
        <span className="player-tag">
          <span className={`piece-dot ${side}`} />
          {isBot ? `Stockfish · ${level.name}` : 'You'}
          {isBot && <span className="muted">(≈{level.rating})</span>}
          {isBot && thinking && <span className="thinking">thinking…</span>}
        </span>
        {ms !== null && (
          <span className={`clock${status === 'playing' && turn === side ? ' active' : ''}${ms < 20_000 ? ' low' : ''}`}>
            {formatClock(ms)}
          </span>
        )}
      </div>
    )
  }

  const resultText = result
    ? result.winner === null
      ? `Draw by ${result.reason}`
      : `${result.winner === player ? 'You won' : 'You lost'} ${result.reason === 'time' ? 'on time' : `by ${result.reason}`}`
    : ''

  return (
    <main className="layout">
      <aside className="sidebar play-side">
        {status === 'setup' ? (
          <div className="setup">
            <h2>Play vs Bot</h2>
            <div className="field">
              <div className="field-label">Bot strength</div>
              <div className="levels">
                {BOT_LEVELS.map((l, i) => (
                  <button
                    key={l.name}
                    className={`level${settings.level === i ? ' selected' : ''}`}
                    onClick={() => setSettings({ ...settings, level: i })}
                  >
                    <span>{l.name}</span>
                    <span className="muted">≈{l.rating}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">Play as</div>
              <div className="segmented">
                {(['w', 'random', 'b'] as const).map((c) => (
                  <button
                    key={c}
                    className={settings.color === c ? 'on' : ''}
                    onClick={() => setSettings({ ...settings, color: c })}
                  >
                    {c === 'w' ? '♔ White' : c === 'b' ? '♚ Black' : 'Random'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">Clock</div>
              <div className="segmented wrap">
                {CLOCKS.map((c, i) => (
                  <button
                    key={c.label}
                    className={settings.clock === i ? 'on' : ''}
                    onClick={() => setSettings({ ...settings, clock: i })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="check field">
              <input
                type="checkbox"
                checked={settings.coach}
                onChange={(e) => setSettings({ ...settings, coach: e.target.checked })}
              />
              Live coach: label each move and show the eval bar
            </label>
            <button className="full play-button" onClick={start}>
              Play
            </button>
          </div>
        ) : (
          <div className="controls">
            <h2>Play vs Bot</h2>
            <p className="muted small">
              {level.name} (≈{level.rating}) · {clockSetting.label} · coach {settings.coach ? 'on' : 'off'}
            </p>
            <button
              className="ghost full"
              onClick={() => setHint((h) => (h + 1) % 3)}
              disabled={!myTurn}
            >
              {hint === 0 ? 'Hint' : hint === 1 ? 'Show the move' : 'Hide hint'}
            </button>
            <button className="ghost full" onClick={takeBack} disabled={!canTakeBack}>
              Take back
            </button>
            {status === 'playing' && (
              <button className="ghost full" onClick={resign}>
                Resign
              </button>
            )}
            <button className="ghost full" onClick={newGame}>
              New game
            </button>
            <label className="check field">
              <input
                type="checkbox"
                checked={settings.coach}
                onChange={(e) => setSettings({ ...settings, coach: e.target.checked })}
              />
              Live coach
            </label>
          </div>
        )}
      </aside>

      <section className="center">
        {strip(orientation === 'white' ? 'b' : 'w')}
        <PlayBoard
          fen={chess.fen()}
          orientation={orientation}
          interactive={myTurn}
          playerColor={player}
          lastMove={
            lastPly
              ? { from: lastPly.from, to: lastPly.to, tint: lastMeta ? `${lastMeta.color}80` : 'rgba(255,220,90,0.45)' }
              : undefined
          }
          selected={selected}
          targets={targets}
          hintSquare={myTurn && hint >= 1 && best ? best.slice(0, 2) : undefined}
          arrows={arrows}
          badge={lastPly && lastMeta ? { square: lastPly.to, symbol: lastMeta.symbol, color: lastMeta.color } : undefined}
          white={showCoach && hereScore ? winPercent(hereScore) : showCoach ? 50 : null}
          evalText={showCoach ? formatScore(hereScore) : undefined}
          onDrop={tryMove}
          onSquareClick={onSquareClick}
        />
        {strip(orientation === 'white' ? 'w' : 'b')}
        <div className="nav">
          <button className="ghost" onClick={() => setFlipped((f) => !f)}>
            Flip
          </button>
        </div>
      </section>

      <aside className="panel">
        {status === 'over' && (
          <div className={`result-card ${result?.winner === player ? 'win' : result?.winner ? 'loss' : 'draw'}`}>
            <div className="result-title">{resultText}</div>
            <div className="result-actions">
              <button onClick={() => onReview(exportPgn())}>Review game</button>
              <button className="ghost" onClick={start}>
                Rematch
              </button>
            </div>
          </div>
        )}
        {status === 'setup' ? (
          <div className="coach">
            <span className="muted">
              Pick a strength and press Play. The coach analyzes every move with full-strength Stockfish while you play,
              and you can take moves back.
            </span>
          </div>
        ) : (
          <div className="coach">
            {!settings.coach && status === 'playing' ? (
              <span className="muted">Live coach is off. The full review is waiting for you at the end.</span>
            ) : myReview && myPly ? (
              <>
                <span className="move-badge big" style={{ background: LABEL_META[myReview.label].color }}>
                  {LABEL_META[myReview.label].symbol}
                </span>
                <div className="coach-text">
                  <div>{describeMove(myReview.label, myPly.san, myReview.bestSan)}</div>
                  <div className="muted small">Eval {formatScore(myReview.scoreAfter)}</div>
                  {status === 'playing' && ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(myReview.label) && (
                    <button className="ghost small-button" onClick={takeBack}>
                      Take back and try again
                    </button>
                  )}
                </div>
              </>
            ) : myPly ? (
              <span className="muted">Checking {myPly.san}…</span>
            ) : (
              <span className="muted">{myTurn ? 'Your move.' : 'The bot moves first.'}</span>
            )}
          </div>
        )}
        {status === 'over' && (
          <>
            <EvalGraph review={review} ply={moves.length} onSelect={() => undefined} />
            <Summary
              review={review}
              white={{ name: player === 'w' ? 'You' : level.name }}
              black={{ name: player === 'b' ? 'You' : level.name }}
              complete={game.fens.every((f) => analyses[f])}
            />
          </>
        )}
        {moves.length > 0 && <MoveList game={game} review={shownReview} ply={moves.length} />}
      </aside>
    </main>
  )
}
