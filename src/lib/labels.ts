import type { Label } from './review'

export const LABEL_META: Record<Label, { name: string; symbol: string; color: string }> = {
  brilliant: { name: 'Brilliant', symbol: '!!', color: '#1fb8b0' },
  great: { name: 'Great', symbol: '!', color: '#4f8fd8' },
  best: { name: 'Best', symbol: '★', color: '#5fa83b' },
  excellent: { name: 'Excellent', symbol: '✓', color: '#7fbf4d' },
  good: { name: 'Good', symbol: '•', color: '#8aa07a' },
  inaccuracy: { name: 'Inaccuracy', symbol: '?!', color: '#e3b52b' },
  mistake: { name: 'Mistake', symbol: '?', color: '#e5862f' },
  miss: { name: 'Miss', symbol: '×', color: '#e06b4e' },
  blunder: { name: 'Blunder', symbol: '??', color: '#d93b3b' },
}

export function describeMove(label: Label, san: string, bestSan?: string): string {
  const name = LABEL_META[label].name.toLowerCase()
  const article = /^[aeiou]/.test(name) ? 'an' : 'a'
  switch (label) {
    case 'best':
      return `${san} is the best move.`
    case 'brilliant':
      return `${san} is brilliant: it gives up material and stays sound.`
    case 'great':
      return `${san} is great: it was the only good move.`
    case 'miss':
      return `${san} misses the chance your opponent just gave you.${bestSan ? ` ${bestSan} was the way to punish it.` : ''}`
    case 'excellent':
    case 'good':
      return `${san} is ${name}.${bestSan ? ` The engine slightly preferred ${bestSan}.` : ''}`
    default:
      return `${san} is ${article} ${name}.${bestSan ? ` Best was ${bestSan}.` : ''}`
  }
}
