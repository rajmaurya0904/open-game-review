import { Chessboard } from 'react-chessboard'
import type { CSSProperties } from 'react'

type Badge = { square: string; symbol: string; color: string }

type Props = {
  fen: string
  orientation: 'white' | 'black'
  interactive: boolean
  playerColor: 'w' | 'b'
  lastMove?: { from: string; to: string; tint: string }
  selected: string | null
  targets: { square: string; capture: boolean }[]
  hintSquare?: string
  arrows: { startSquare: string; endSquare: string; color: string }[]
  badge?: Badge
  white: number | null // White's win chance for the eval bar; null hides it
  evalText?: string
  onDrop: (from: string, to: string) => boolean
  onSquareClick: (square: string) => void
}

export function PlayBoard(p: Props) {
  const styles: Record<string, CSSProperties> = {}
  const tint = (sq: string, color: string) => {
    styles[sq] = { ...styles[sq], boxShadow: `inset 0 0 0 999px ${color}` }
  }
  if (p.lastMove) {
    tint(p.lastMove.from, p.lastMove.tint)
    tint(p.lastMove.to, p.lastMove.tint)
  }
  if (p.hintSquare) tint(p.hintSquare, 'rgba(79,143,216,0.55)')
  if (p.selected) tint(p.selected, 'rgba(255, 220, 90, 0.55)')
  for (const t of p.targets) {
    styles[t.square] = {
      ...styles[t.square],
      backgroundImage: t.capture
        ? 'radial-gradient(circle, transparent 58%, rgba(0,0,0,0.28) 60%)'
        : 'radial-gradient(circle, rgba(0,0,0,0.25) 18%, transparent 20%)',
    }
  }

  return (
    <div className={`board-wrap ${p.orientation}`}>
      <div className={`eval-bar${p.white === null ? ' hidden' : ''}`} title={p.evalText}>
        <div className="eval-bar-white" style={{ height: `${p.white ?? 50}%` }} />
        {p.white !== null && (
          <span className={`eval-bar-text ${p.white >= 50 ? 'on-white' : 'on-black'}`}>{p.evalText}</span>
        )}
      </div>
      <div className="board">
        <Chessboard
          options={{
            id: 'play',
            position: p.fen,
            boardOrientation: p.orientation,
            allowDragging: p.interactive,
            canDragPiece: ({ piece }) => p.interactive && piece.pieceType[0] === p.playerColor,
            onPieceDrop: ({ sourceSquare, targetSquare }) =>
              targetSquare ? p.onDrop(sourceSquare, targetSquare) : false,
            onSquareClick: ({ square }) => p.onSquareClick(square),
            arrows: p.arrows,
            animationDurationInMs: 180,
            darkSquareStyle: { backgroundColor: '#7a8fa6' },
            lightSquareStyle: { backgroundColor: '#dfe5ea' },
            // A custom renderer replaces the library's styled square, so tints are applied here.
            squareRenderer: ({ square, children }) => (
              <div style={{ position: 'relative', width: '100%', height: '100%', ...styles[square] }}>
                {children}
                {p.badge && square === p.badge.square && (
                  <span className="square-badge" style={{ background: p.badge.color }}>
                    {p.badge.symbol}
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
