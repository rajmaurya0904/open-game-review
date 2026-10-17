import { useEffect, useMemo, useRef, useState } from 'react'
import { reviewEngine, type PositionAnalysis } from './engine'
import { buildReview, parseGame, terminalScore, type ParsedGame } from './review'

const CACHE_PREFIX = 'ogr:v1:'

function readCache(key: string): PositionAnalysis[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    return raw ? (JSON.parse(raw) as PositionAnalysis[]) : null
  } catch {
    return null
  }
}

function writeCache(key: string, value: PositionAnalysis[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the review still works, it just isn't remembered.
  }
}

export type ReviewSource = { id: string; pgn: string }

export function useReview(source: ReviewSource | null, depth: number) {
  const [analyses, setAnalyses] = useState<(PositionAnalysis | undefined)[]>([])
  const [error, setError] = useState<string | null>(null)
  const token = useRef(0)

  const game: ParsedGame | null = useMemo(() => {
    if (!source) return null
    try {
      return parseGame(source.pgn)
    } catch {
      return null
    }
  }, [source])

  useEffect(() => {
    const run = ++token.current
    setError(null)
    if (!source) {
      setAnalyses([])
      return
    }
    if (!game) {
      setAnalyses([])
      setError('Could not read this game’s moves.')
      return
    }
    const key = `${source.id}:${depth}`
    const cached = readCache(key)
    if (cached && cached.length === game.fens.length) {
      setAnalyses(cached)
      return
    }

    const results: (PositionAnalysis | undefined)[] = new Array(game.fens.length).fill(undefined)
    setAnalyses([...results])
    ;(async () => {
      try {
        const sf = reviewEngine()
        for (let i = 0; i < game.fens.length; i++) {
          if (run !== token.current) return
          const fen = game.fens[i]
          const terminal = terminalScore(fen)
          results[i] = terminal ? { depth: 0, lines: [], terminal } : await sf.analyze(fen, depth)
          if (run !== token.current) return
          setAnalyses([...results])
        }
        writeCache(key, results as PositionAnalysis[])
      } catch (e) {
        if (run === token.current) setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      // Abandon this run; finish the in-flight search quickly.
      if (run === token.current) token.current++
      reviewEngine().stop()
    }
  }, [source, game, depth])

  const review = useMemo(() => (game ? buildReview(game, analyses) : null), [game, analyses])
  const done = analyses.filter(Boolean).length
  const total = game?.fens.length ?? 0

  return { game, review, analyses, progress: total ? done / total : 0, complete: total > 0 && done === total, error }
}
