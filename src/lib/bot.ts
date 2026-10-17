import { Chess } from 'chess.js'
import { botEngine, type EngineOptions } from './engine'

export type BotLevel = {
  name: string
  rating: number // approximate playing strength shown to the user
  options: EngineOptions
  limit: { depth?: number; movetime?: number }
  randomChance?: number // chance of a random legal move, so low levels blunder like people do
}

// Stockfish's own Elo limiter starts at 1320; weaker levels use Skill Level 0
// with a shallow search plus occasional random moves.
const WEAK = (skill: number): EngineOptions => ({ UCI_LimitStrength: false, 'Skill Level': skill })
const ELO = (elo: number): EngineOptions => ({ UCI_LimitStrength: true, UCI_Elo: elo, 'Skill Level': 20 })

export const BOT_LEVELS: BotLevel[] = [
  { name: 'Beginner', rating: 500, options: WEAK(0), limit: { depth: 1 }, randomChance: 0.35 },
  { name: 'Novice', rating: 800, options: WEAK(0), limit: { depth: 2 }, randomChance: 0.2 },
  { name: 'Casual', rating: 1100, options: WEAK(0), limit: { depth: 4 }, randomChance: 0.08 },
  { name: 'Club', rating: 1350, options: ELO(1350), limit: { movetime: 400 } },
  { name: 'Intermediate', rating: 1600, options: ELO(1600), limit: { movetime: 400 } },
  { name: 'Advanced', rating: 1800, options: ELO(1800), limit: { movetime: 500 } },
  { name: 'Expert', rating: 2000, options: ELO(2000), limit: { movetime: 500 } },
  { name: 'Strong expert', rating: 2200, options: ELO(2200), limit: { movetime: 600 } },
  { name: 'Master', rating: 2500, options: ELO(2500), limit: { movetime: 700 } },
  { name: 'Grandmaster', rating: 2850, options: ELO(2850), limit: { movetime: 800 } },
  { name: 'Maximum', rating: 3200, options: { UCI_LimitStrength: false, 'Skill Level': 20 }, limit: { movetime: 1000 } },
]

let configured: BotLevel | null = null

export async function chooseBotMove(fen: string, level: BotLevel): Promise<string | null> {
  if (level.randomChance && Math.random() < level.randomChance) {
    const moves = new Chess(fen).moves({ verbose: true })
    const m = moves[Math.floor(Math.random() * moves.length)]
    if (m) return m.from + m.to + (m.promotion ?? '')
  }
  const engine = botEngine()
  if (configured !== level) {
    configured = level
    await engine.configure(level.options)
  }
  return engine.bestMove(fen, level.limit)
}

export function stopBot() {
  botEngine().stop()
}
