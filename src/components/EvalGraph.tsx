import type { GameReview } from '../lib/review'
import { LABEL_META } from '../lib/labels'

type Props = { review: GameReview; ply: number; onSelect: (ply: number) => void }

const FLAGGED = new Set(['brilliant', 'great', 'mistake', 'miss', 'blunder'])

export function EvalGraph({ review, ply, onSelect }: Props) {
  const n = review.whiteWin.length
  const width = 600
  const height = 110
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * width)
  const y = (w: number) => height - (w / 100) * height

  // Unanalyzed positions are drawn at 50% so the curve fills in as analysis runs.
  const points = review.whiteWin.map((w, i) => `${x(i).toFixed(1)},${y(w ?? 50).toFixed(1)}`)
  const area = `M0,${height} L${points.join(' L')} L${width},${height} Z`

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1))
    onSelect(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onClick={pick}
      role="img"
      aria-label="Evaluation over the game"
    >
      <rect width={width} height={height} className="eval-graph-bg" />
      <path d={area} className="eval-graph-area" />
      <line x1={0} x2={width} y1={height / 2} y2={height / 2} className="eval-graph-mid" />
      {review.moves.map((m, i) =>
        m && FLAGGED.has(m.label) ? (
          <circle
            key={i}
            cx={x(i + 1)}
            cy={y(review.whiteWin[i + 1] ?? 50)}
            r={4}
            fill={LABEL_META[m.label].color}
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
      <line x1={x(ply)} x2={x(ply)} y1={0} y2={height} className="eval-graph-cursor" />
    </svg>
  )
}
