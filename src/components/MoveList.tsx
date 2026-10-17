import { useEffect, useRef } from 'react'
import type { GameReview, ParsedGame } from '../lib/review'
import { LABEL_META } from '../lib/labels'

type Props = { game: ParsedGame; review: GameReview; ply: number; onSelect?: (ply: number) => void }

export function MoveList({ game, review, ply, onSelect }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const active = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (ply === 0) list.current?.scrollTo({ top: 0 })
    else active.current?.scrollIntoView({ block: 'nearest' })
  }, [ply, game])

  const rows: { number: number; cells: (number | null)[] }[] = []
  game.plies.forEach((p, i) => {
    if (p.color === 'w' || rows.length === 0) rows.push({ number: p.moveNumber, cells: [null, null] })
    rows[rows.length - 1].cells[p.color === 'w' ? 0 : 1] = i
  })

  return (
    <div className="move-list" ref={list}>
      {rows.map((row) => (
        <div className="move-row" key={row.number}>
          <span className="move-number">{row.number}.</span>
          {row.cells.map((i, c) => {
            if (i === null) return <span key={c} className="move-cell empty" />
            const m = review.moves[i]
            const meta = m && LABEL_META[m.label]
            const selected = ply === i + 1
            return (
              <button
                key={c}
                ref={selected ? active : undefined}
                className={`move-cell${selected ? ' selected' : ''}${onSelect ? '' : ' static'}`}
                onClick={onSelect && (() => onSelect(i + 1))}
                title={meta?.name}
              >
                {meta && (
                  <span className="move-badge" style={{ background: meta.color }}>
                    {meta.symbol}
                  </span>
                )}
                {game.plies[i].san}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
