// Paragraphs whose inline math plain text can't draw (F_b: Unicode has no
// subscript b) are laid out by the mod: words as text, each formula as a small
// typeset image. This file cuts markdown into those paragraphs and the plain
// markdown around them, and reads a paragraph's inline formatting.

/**
 * One inline formula: its TeX, its Unicode (escaped for markdown as `md`), and
 * whether that Unicode draws it cleanly.
 */
export type InlineMath = { tex: string; text: string; md: string; clean: boolean }

export type Run =
  | { kind: 'text'; text: string; bold: boolean; italic: boolean; code: boolean; href?: string; spaceAfter: boolean }
  | { kind: 'math'; tex: string; text: string; spaceAfter: boolean }

/** A paragraph, list item or heading the mod lays out itself. */
export type RichBlock = { marker: string | null; heading: boolean; runs: Run[] }

export type Block = { md: string } | { rich: RichBlock }

/** Where a formula left for the mod stands in the converted markdown. */
export const mark = (n: number): string => '' + n + ''

const LIST = /^\s*([-*+]|\d{1,9}[.)])\s+/
const HEADING = /^\s{0,3}#{1,6}\s+/

/**
 * Cuts markdown into plain blocks and the paragraphs, list items and headings
 * that hold a marked formula.
 */
export function segment(md: string, inline: readonly InlineMath[]): Block[] {
  const unclean = (text: string): boolean =>
    [...text.matchAll(/(\d+)/g)].some(m => inline[Number(m[1])]?.clean === false)
  // A formula outside a laid-out paragraph goes back to its Unicode.
  const unmark = (text: string): string => text.replace(/(\d+)/g, (_m, n: string) => inline[Number(n)]?.md ?? '')
  if (!unclean(md)) return [{ md: unmark(md) }]
  const lines = md.split('\n')

  type Unit = { start: number; end: number }
  const units: Unit[] = []
  let cur: Unit | null = null
  lines.forEach((line, k) => {
    if (line.trim() === '') {
      cur = null
      return
    }
    const heading = HEADING.test(line.replace(/^\s*(?:>\s?)*/, ''))
    if (cur === null || LIST.test(line.replace(/^\s*(?:>\s?)*/, '')) || heading) {
      cur = { start: k, end: k + 1 }
      units.push(cur)
      if (heading) cur = null
    } else {
      cur.end = k + 1
    }
  })

  const blocks: Block[] = []
  let from = 0
  const flush = (to: number): void => {
    const text = lines.slice(from, to).join('\n').replace(/^\s*\n/, '').replace(/\n\s*$/, '')
    if (text.trim() !== '') blocks.push({ md: unmark(text) })
  }
  for (const u of units) {
    const body = lines.slice(u.start, u.end)
    if (!unclean(body.join('\n'))) continue
    flush(u.start)
    blocks.push({ rich: richBlock(body, inline) })
    from = u.end
  }
  flush(lines.length)
  return blocks
}

function richBlock(body: string[], inline: readonly InlineMath[]): RichBlock {
  const unquoted = body.map(l => l.replace(/^\s*(?:>\s?)*/, ''))
  let first = unquoted[0] ?? ''
  let marker: string | null = null
  let heading = false
  const item = LIST.exec(first)
  if (item) {
    marker = /^\d/.test(item[1]!) ? item[1]! : '•'
    first = first.slice(item[0].length)
  } else if (HEADING.test(first)) {
    heading = true
    first = first.replace(HEADING, '')
  }
  const text = [first, ...unquoted.slice(1)].map(l => l.trim()).join(' ')
  return { marker, heading, runs: parseInline(text, inline) }
}

type Piece = { text: string; bold: boolean; italic: boolean; code: boolean; href?: string } | InlineMath

const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** A paragraph's text as words and formulas, each word with its formatting. */
export function parseInline(s: string, inline: readonly InlineMath[]): Run[] {
  const pieces: Piece[] = []
  let bold = false
  let italic = false
  let buf = ''
  const flush = (): void => {
    if (buf) pieces.push({ text: buf, bold, italic, code: false })
    buf = ''
  }

  for (let i = 0; i < s.length; ) {
    const c = s[i]!
    if (c === '\\' && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1]!)) {
      buf += s[i + 1]
      i += 2
      continue
    }
    if (c === '') {
      const j = s.indexOf('', i)
      const math = j > 0 ? inline[Number(s.slice(i + 1, j))] : undefined
      if (math) {
        flush()
        pieces.push(math)
        i = j + 1
        continue
      }
    }
    if (c === '`') {
      let n = 0
      while (s[i + n] === '`') n++
      const close = s.indexOf('`'.repeat(n), i + n)
      if (close > 0) {
        flush()
        pieces.push({ text: s.slice(i + n, close).trim(), bold, italic, code: true })
        i = close + n
        continue
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] === c) {
      flush()
      bold = !bold
      i += 2
      continue
    }
    if (c === '*' && !(s[i - 1] === ' ' && s[i + 1] === ' ')) {
      flush()
      italic = !italic
      i++
      continue
    }
    if (c === '_' && !(isWord(s[i - 1]) && isWord(s[i + 1]))) {
      flush()
      italic = !italic
      i++
      continue
    }
    if (c === '[') {
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(s.slice(i))
      if (m) {
        flush()
        pieces.push({ text: m[1]!, bold, italic, code: false, href: m[2]! })
        i += m[0].length
        continue
      }
    }
    buf += c
    i++
  }
  flush()

  const runs: Run[] = []
  const space = (): void => {
    const last = runs[runs.length - 1]
    if (last) last.spaceAfter = true
  }
  for (const p of pieces) {
    if ('tex' in p) {
      runs.push({ kind: 'math', tex: p.tex, text: p.text, spaceAfter: false })
      continue
    }
    if (p.code || p.href) {
      if (/^\s/.test(p.text)) space()
      runs.push({ kind: 'text', text: p.text.trim(), bold: p.bold, italic: p.italic, code: p.code, href: p.href, spaceAfter: /\s$/.test(p.text) })
      continue
    }
    for (const part of p.text.split(/(\s+)/)) {
      if (part === '') continue
      if (/^\s+$/.test(part)) space()
      else runs.push({ kind: 'text', text: part, bold: p.bold, italic: p.italic, code: false, spaceAfter: false })
    }
  }
  return runs
}
