// Chess.com published-data API (https://www.chess.com/news/view/published-data-api).
// It only exposes finished games; monthly archives are cached for about a minute.

export type ApiPlayer = { username: string; rating: number; result: string }

export type ApiGame = {
  url: string
  uuid: string
  pgn?: string
  end_time: number
  time_class: string
  time_control: string
  rated: boolean
  rules: string
  white: ApiPlayer
  black: ApiPlayer
}

const BASE = 'https://api.chess.com/pub/player'

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-cache' })
  if (res.status === 404) return null
  if (res.status === 429) throw new Error('Chess.com is rate limiting requests. Wait a minute and try again.')
  if (!res.ok) throw new Error(`Chess.com API returned ${res.status}`)
  return (await res.json()) as T
}

export async function getArchives(username: string): Promise<string[]> {
  const data = await getJson<{ archives: string[] }>(`${BASE}/${username.toLowerCase()}/games/archives`)
  if (!data) throw new Error(`No Chess.com player named "${username}"`)
  return data.archives
}

/** Standard-chess games from one monthly archive, newest first. */
export async function getMonth(archiveUrl: string): Promise<ApiGame[]> {
  const data = await getJson<{ games: ApiGame[] }>(archiveUrl)
  return (data?.games ?? [])
    .filter((g) => g.rules === 'chess' && g.pgn)
    .sort((a, b) => b.end_time - a.end_time)
}

export function currentMonthUrl(username: string, now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${BASE}/${username.toLowerCase()}/games/${y}/${m}`
}

const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])

export function resultFor(game: ApiGame, username: string): 'win' | 'loss' | 'draw' | null {
  const me = sideOf(game, username)
  if (!me) return null
  const r = game[me].result
  if (r === 'win') return 'win'
  if (DRAWS.has(r)) return 'draw'
  return 'loss'
}

export function sideOf(game: ApiGame, username: string): 'white' | 'black' | null {
  const u = username.toLowerCase()
  if (game.white.username.toLowerCase() === u) return 'white'
  if (game.black.username.toLowerCase() === u) return 'black'
  return null
}
