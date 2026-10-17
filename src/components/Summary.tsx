import { LABELS, type GameReview } from '../lib/review'
import { LABEL_META } from '../lib/labels'

type Player = { name: string; rating?: string }
type Props = { review: GameReview; white: Player; black: Player; complete: boolean }

const fmt = (a: number | null) => (a === null ? '—' : a.toFixed(1))

export function Summary({ review, white, black, complete }: Props) {
  return (
    <div className="summary">
      <div className="accuracy-row">
        <div className="accuracy-card light">
          <div className="accuracy-name">
            {white.name} {white.rating && <span className="muted">({white.rating})</span>}
          </div>
          <div className="accuracy-value">{complete ? fmt(review.accuracy.w) : '…'}</div>
        </div>
        <div className="accuracy-label muted">Accuracy</div>
        <div className="accuracy-card dark">
          <div className="accuracy-name">
            {black.name} {black.rating && <span className="muted">({black.rating})</span>}
          </div>
          <div className="accuracy-value">{complete ? fmt(review.accuracy.b) : '…'}</div>
        </div>
      </div>
      <table className="label-table">
        <tbody>
          {LABELS.map((l) => (
            <tr key={l}>
              <td className="count">{review.counts.w[l]}</td>
              <td>
                <span className="move-badge" style={{ background: LABEL_META[l].color }}>
                  {LABEL_META[l].symbol}
                </span>
                {LABEL_META[l].name}
              </td>
              <td className="count">{review.counts.b[l]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
