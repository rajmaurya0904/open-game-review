import { resultFor, sideOf, type ApiGame } from '../lib/chesscom'

type Props = {
  games: ApiGame[]
  username: string
  selected: string | null
  freshIds: Set<string>
  onSelect: (game: ApiGame) => void
}

const RESULT_TEXT = { win: 'Won', loss: 'Lost', draw: 'Draw' } as const

function when(endTime: number) {
  const d = new Date(endTime * 1000)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function GameList({ games, username, selected, freshIds, onSelect }: Props) {
  if (games.length === 0) return <p className="muted pad">No standard games found yet.</p>
  return (
    <ul className="game-list">
      {games.map((g) => {
        const me = sideOf(g, username)
        const opp = me === 'white' ? g.black : me === 'black' ? g.white : null
        const result = resultFor(g, username)
        return (
          <li key={g.uuid}>
            <button
              className={`game-item${selected === g.uuid ? ' selected' : ''}`}
              onClick={() => onSelect(g)}
            >
              <span className={`result-dot ${result ?? 'none'}`} title={result ? RESULT_TEXT[result] : ''} />
              <span className="game-main">
                <span className="game-opp">
                  {opp ? `vs ${opp.username}` : `${g.white.username} – ${g.black.username}`}
                  {opp && <span className="muted"> {opp.rating}</span>}
                  {freshIds.has(g.uuid) && <span className="fresh">new</span>}
                </span>
                <span className="game-meta muted">
                  {g.time_class} · {me === 'white' ? '♔ White' : me === 'black' ? '♚ Black' : ''} ·{' '}
                  {when(g.end_time)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
