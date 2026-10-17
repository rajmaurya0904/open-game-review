import { Chessboard } from 'react-chessboard'
import type { CSSProperties } from 'react'
import { LABEL_META } from '../lib/labels'
import { evalOf, formatScore, winPercent, type GameReview, type ParsedGame } from '../lib/review'
import type { PositionAnalysis } from '../lib/engine'

type Props = {
  game: ParsedGame
  review: GameReview
  analyses: (PositionAnalysis | undefined)[]
  ply: number
  orientation: 'white' | 'black'
  showEngine: boolean
}

export function ReviewBoard({ game, review, analyses, ply, orientation, showEngine }: Props) {
  const fen = game.fens[ply]
  const move = ply > 0 ? review.moves[ply - 1] : null
  const played = ply > 0 ? game.plies[ply - 1] : null
  const here = analyses[ply]
  const score = here && evalOf(here)
  const white = score ? winPercent(score) : 50

  const squareStyles: Record<string, CSSProperties> = {}
  if (played) {
    const tint = move ? `${LABEL_META[move.label].color}80` : 'rgba(255, 220, 90, 0.45)'
    // An inset shadow tints the square without replacing its light/dark color.
    squareStyles[played.from] = { boxShadow: `inset 0 0 0 999px ${tint}` }
    squareStyles[played.to] = { boxShadow: `inset 0 0 0 999px ${tint}` }
  }

  const arrows = []
  if (move && move.bestUci && !['best', 'great', 'brilliant'].includes(move.label)) {
    arrows.push({ startSquare: move.bestUci.slice(0, 2), endSquare: move.bestUci.slice(2, 4), color: 'rgba(95,168,59,0.75)' })
  }
  const next = here?.lines[0]?.pv[0]
  if (showEngine && next) {
    arrows.push({ startSquare: next.slice(0, 2), endSquare: next.slice(2, 4), color: 'rgba(79,143,216,0.8)' })
  }

  const badgeSquare = played?.to
  const badge = move ? LABEL_META[move.label] : null

  return (
    <div className={`board-wrap ${orientation}`}>
      <div className="eval-bar" title={formatScore(score)}>
        <div className="eval-bar-white" style={{ height: `${white}%` }} />
        <span className={`eval-bar-text ${white >= 50 ? 'on-white' : 'on-black'}`}>{formatScore(score)}</span>
      </div>
      <div className="board">
        <Chessboard
          options={{
            id: 'review',
            position: fen,
            boardOrientation: orientation,
            allowDragging: false,
            arrows,
            animationDurationInMs: 150,
            darkSquareStyle: { backgroundColor: '#7a8fa6' },
            lightSquareStyle: { backgroundColor: '#dfe5ea' },
            // A custom renderer replaces the library's styled square, so tints are applied here.
            squareRenderer: ({ square, children }) => (
              <div style={{ position: 'relative', width: '100%', height: '100%', ...squareStyles[square] }}>
                {children}
                {badge && square === badgeSquare && (
                  <span className="square-badge" style={{ background: badge.color }}>
                    {badge.symbol}
                  </span>
                )}
              </div>
            ),
          }}
        />
      </div>
    </div>
  )
}
