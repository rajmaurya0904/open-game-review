// Copies the single-threaded lite Stockfish build into public/engine so Vite serves it.
// The worker loads its .wasm from the same path with the extension swapped, so both
// files must keep matching names.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'stockfish', 'bin')
const dest = join(root, 'public', 'engine')

mkdirSync(dest, { recursive: true })
copyFileSync(join(src, 'stockfish-18-lite-single.js'), join(dest, 'stockfish.js'))
copyFileSync(join(src, 'stockfish-18-lite-single.wasm'), join(dest, 'stockfish.wasm'))
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(dest, 'COPYING.txt'))
console.log('Stockfish copied to public/engine')
