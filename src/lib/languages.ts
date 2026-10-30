/**
 * Building colours per language: each one's GitHub colour, nudged into a bright, friendly
 * Kurzgesagt-style palette so the city looks good together.
 */
const COLORS: Record<string, string> = {
  TypeScript: '#4a7cf0',
  JavaScript: '#ffcb47',
  Python: '#3fa7e0',
  'C#': '#3fbf6f',
  Java: '#e8914a',
  Go: '#33c9d6',
  Rust: '#f0956a',
  'C++': '#f2668b',
  C: '#8f9bb8',
  HTML: '#ff7350',
  CSS: '#9b6cf0',
  SCSS: '#d96aa8',
  Vue: '#3fcf95',
  Svelte: '#ff6a3d',
  PHP: '#7d84d9',
  Ruby: '#e0465a',
  Kotlin: '#b07cff',
  Swift: '#ff7a59',
  Dart: '#2fc6c0',
  Shell: '#8fdb5a',
  PowerShell: '#4f8fd9',
  'Jupyter Notebook': '#ff9d3d',
  Lua: '#5a6fe0',
  Elixir: '#a46ad9',
  Haskell: '#8d72d1',
  Scala: '#e0525f',
  'Objective-C': '#5aa0f0',
  R: '#3e8fd6',
  Dockerfile: '#5a8fa8',
  Makefile: '#6fbf73',
  TeX: '#4fb3a0',
  Zig: '#f4b04f',
  Nix: '#7fa8e8',
  MDX: '#f2c94c',
  Astro: '#ff7a4d',
  Solidity: '#9aa3b5',
  Assembly: '#b8a07a',
  Clojure: '#7ac74f',
  'F#': '#c97ce0',
  Julia: '#a26ae0',
  Perl: '#5b8fcf',
  'Visual Basic .NET': '#9a7cf0',
  GDScript: '#5ab0d6',
  'Vim Script': '#3fbf6f',
  'Emacs Lisp': '#c06fd9',
}

const FALLBACK = ['#ff8fb1', '#7bd389', '#ffb35c', '#6ec6ff', '#c792ea', '#f78c6c', '#89ddff', '#ffd166']
export const NO_LANGUAGE = 'Docs & other'
const NO_LANGUAGE_COLOR = '#c9c4e6'

export function languageColor(lang: string) {
  if (lang === NO_LANGUAGE) return NO_LANGUAGE_COLOR
  if (COLORS[lang]) return COLORS[lang]
  let h = 0
  for (let i = 0; i < lang.length; i++) h = (h * 31 + lang.charCodeAt(i)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}
