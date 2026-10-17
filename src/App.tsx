import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameList } from './components/GameList'
import { EvalGraph } from './components/EvalGraph'
import { MoveList } from './components/MoveList'
import { ReviewBoard } from './components/ReviewBoard'
import { Summary } from './components/Summary'
import { currentMonthUrl, getArchives, getMonth, sideOf, type ApiGame } from './lib/chesscom'
import { describeMove, LABEL_META } from './lib/labels'
import { formatScore } from './lib/review'
import { useReview, type ReviewSource } from './lib/useReview'

const POLL_MS = 30_000
const DEPTHS = [10, 14, 18]

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function hash(text: string) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export default function App() {
  const [input, setInput] = useState(() => stored('ogr:user', ''))
  const [username, setUsername] = useState('')
  const [archives, setArchives] = useState<string[]>([])
  const [monthsLoaded, setMonthsLoaded] = useState(0)
  const [games, setGames] = useState<ApiGame[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [source, setSource] = useState<ReviewSource | null>(null)
  const [selectedGame, setSelectedGame] = useState<ApiGame | null>(null)
  const [depth, setDepth] = useState(() => Number(stored('ogr:depth', '14')))
  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [showEngine, setShowEngine] = useState(false)

  const [watching, setWatching] = useState(false)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [pgnOpen, setPgnOpen] = useState(false)
  const [pgnText, setPgnText] = useState('')

  const { game, review, analyses, progress, complete, error: reviewError } = useReview(source, depth)

  const openGame = useCallback((g: ApiGame) => {
    setSelectedGame(g)
    setSource({ id: g.uuid, pgn: g.pgn ?? '' })
    setPly(0)
    setFlipped(false)
  }, [])

  const loadUser = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const name = input.trim()
    if (!name) return
    setLoading(true)
    setError(null)
    try {
      const list = await getArchives(name)
      // Load recent months until there is something to show (at most three).
      let collected: ApiGame[] = []
      let used = 0
      for (let i = list.length - 1; i >= 0 && used < 3 && collected.length === 0; i--, used++) {
        collected = await getMonth(list[i])
      }
      setUsername(name)
      store('ogr:user', name)
      setArchives(list)
      setMonthsLoaded(used)
      setGames(collected)
      setFreshIds(new Set())
      if (collected[0]) openGame(collected[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const loadOlder = async () => {
    const idx = archives.length - 1 - monthsLoaded
    if (idx < 0) return
    setLoading(true)
    try {
      const older = await getMonth(archives[idx])
      setGames((g) => [...g, ...older])
      setMonthsLoaded((n) => n + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // Watch for newly finished games and open the newest one automatically.
  const known = useRef(new Set<string>())
  useEffect(() => {
    known.current = new Set(games.map((g) => g.uuid))
  }, [games])

  useEffect(() => {
    if (!watching || !username) return
    let stopped = false
    const check = async () => {
      try {
        const month = await getMonth(currentMonthUrl(username))
        if (stopped) return
        setLastCheck(new Date())
        const fresh = month.filter((g) => !known.current.has(g.uuid))
        if (fresh.length === 0) return
        setGames((g) => [...fresh, ...g].sort((a, b) => b.end_time - a.end_time))
        setFreshIds((s) => new Set([...s, ...fresh.map((g) => g.uuid)]))
        openGame(fresh[0])
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Game review ready', { body: `Your game vs ${opponentOf(fresh[0], username)} is being reviewed.` })
        }
      } catch {
        // Transient network or rate-limit errors: try again next tick.
      }
    }
    check()
    const timer = window.setInterval(check, POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [watching, username, openGame])

  const toggleWatch = () => {
    if (!watching && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
    setWatching((w) => !w)
  }

  const reviewPgn = () => {
    const pgn = pgnText.trim()
    if (!pgn) return
    setSelectedGame(null)
    setSource({ id: `pgn:${hash(pgn)}`, pgn })
    setPly(0)
    setFlipped(false)
    setPgnOpen(false)
  }

  const maxPly = game ? game.plies.length : 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1))
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(maxPly, p + 1))
      else if (e.key === 'Home') setPly(0)
      else if (e.key === 'End') setPly(maxPly)
      else if (e.key === 'f') setFlipped((f) => !f)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maxPly])

  const mySide = selectedGame && username ? sideOf(selectedGame, username) : null
  const baseOrientation = mySide ?? 'white'
  const orientation = flipped ? (baseOrientation === 'white' ? 'black' : 'white') : baseOrientation

  const players = useMemo(() => {
    const h = game?.headers ?? {}
    return {
      white: { name: selectedGame?.white.username ?? h.White ?? 'White', rating: String(selectedGame?.white.rating ?? h.WhiteElo ?? '') },
      black: { name: selectedGame?.black.username ?? h.Black ?? 'Black', rating: String(selectedGame?.black.rating ?? h.BlackElo ?? '') },
    }
  }, [game, selectedGame])

  const current = ply > 0 ? review?.moves[ply - 1] : null
  const currentPly = ply > 0 ? game?.plies[ply - 1] : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♞</span> Open Game Review
        </div>
        <form className="user-form" onSubmit={loadUser}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Chess.com username"
            aria-label="Chess.com username"
            spellCheck={false}
          />
          <button type="submit" disabled={loading || !input.trim()}>
            {loading ? 'Loading…' : 'Load games'}
          </button>
        </form>
        <div className="top-actions">
          <button className="ghost" onClick={() => setPgnOpen((o) => !o)}>
            Paste PGN
          </button>
          <label className="depth">
            Depth
            <select
              value={depth}
              onChange={(e) => {
                setDepth(Number(e.target.value))
                store('ogr:depth', e.target.value)
              }}
            >
              {DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {pgnOpen && (
        <div className="pgn-panel">
          <textarea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder="Paste a PGN from any site…"
            rows={6}
          />
          <div className="pgn-actions">
            <button onClick={reviewPgn} disabled={!pgnText.trim()}>
              Review this game
            </button>
            <button className="ghost" onClick={() => setPgnOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <aside className="sidebar">
          {username ? (
            <>
              <div className="watch">
                <button className={`watch-toggle${watching ? ' on' : ''}`} onClick={toggleWatch}>
                  <span className="watch-dot" /> {watching ? 'Watching for new games' : 'Watch for new games'}
                </button>
                <p className="muted small">
                  {watching
                    ? `Checks every 30 s${lastCheck ? `, last at ${lastCheck.toLocaleTimeString()}` : ''}. Finished games open here automatically, usually within a minute or two.`
                    : 'Opens each game for review as soon as Chess.com publishes it. Games in progress are never analyzed.'}
                </p>
              </div>
              <GameList
                games={games}
                username={username}
                selected={selectedGame?.uuid ?? null}
                freshIds={freshIds}
                onSelect={openGame}
              />
              {monthsLoaded < archives.length && (
                <button className="ghost full" onClick={loadOlder} disabled={loading}>
                  Load older games
                </button>
              )}
            </>
          ) : (
            <div className="intro">
              <h2>Unlimited game reviews</h2>
              <p className="muted">
                Enter your Chess.com username to load your finished games, or paste a PGN. Stockfish runs in your browser,
                so reviews are free and unlimited.
              </p>
            </div>
          )}
        </aside>

        <section className="center">
          {game && review ? (
            <>
              <div className="player-strip">
                <PlayerTag {...(orientation === 'white' ? players.black : players.white)} side={orientation === 'white' ? 'b' : 'w'} />
              </div>
              <ReviewBoard
                game={game}
                review={review}
                analyses={analyses}
                ply={ply}
                orientation={orientation}
                showEngine={showEngine}
              />
              <div className="player-strip">
                <PlayerTag {...(orientation === 'white' ? players.white : players.black)} side={orientation === 'white' ? 'w' : 'b'} />
              </div>
              <div className="nav">
                <button onClick={() => setPly(0)} aria-label="First move">⏮</button>
                <button onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Previous move">◀</button>
                <button onClick={() => setPly((p) => Math.min(maxPly, p + 1))} aria-label="Next move">▶</button>
                <button onClick={() => setPly(maxPly)} aria-label="Last move">⏭</button>
                <button className="ghost" onClick={() => setFlipped((f) => !f)}>Flip</button>
                <label className="check">
                  <input type="checkbox" checked={showEngine} onChange={(e) => setShowEngine(e.target.checked)} />
                  Engine move
                </label>
              </div>
            </>
          ) : (
            <div className="empty-board muted">{reviewError ?? 'Pick a game to review.'}</div>
          )}
        </section>

        <aside className="panel">
          {game && review && (
            <>
              {!complete && (
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
                  <span>Analyzing… {Math.round(progress * 100)}%</span>
                </div>
              )}
              {reviewError && <div className="banner error">{reviewError}</div>}
              <div className="coach">
                {current && currentPly ? (
                  <>
                    <span className="move-badge big" style={{ background: LABEL_META[current.label].color }}>
                      {LABEL_META[current.label].symbol}
                    </span>
                    <div>
                      <div>{describeMove(current.label, currentPly.san, current.bestSan)}</div>
                      <div className="muted small">Eval {formatScore(current.scoreAfter)}</div>
                    </div>
                  </>
                ) : currentPly ? (
                  <span className="muted">Analyzing {currentPly.san}…</span>
                ) : (
                  <span className="muted">Starting position. Use ← → to step through the game.</span>
                )}
              </div>
              <EvalGraph review={review} ply={ply} onSelect={setPly} />
              <Summary review={review} white={players.white} black={players.black} complete={complete} />
              <MoveList game={game} review={review} ply={ply} onSelect={setPly} />
              {selectedGame && (
                <a className="muted small source-link" href={selectedGame.url} target="_blank" rel="noreferrer">
                  View game on Chess.com ↗
                </a>
              )}
            </>
          )}
        </aside>
      </main>
    </div>
  )
}

function PlayerTag({ name, rating, side }: { name: string; rating?: string; side: 'w' | 'b' }) {
  return (
    <span className="player-tag">
      <span className={`piece-dot ${side}`} />
      {name} {rating && <span className="muted">({rating})</span>}
    </span>
  )
}

function opponentOf(g: ApiGame, username: string) {
  return sideOf(g, username) === 'white' ? g.black.username : g.white.username
}
