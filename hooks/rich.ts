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
  | { kind: 'text'; text: string; bold: boolean; italic: boolean; strike: boolean; code: boolean; href?: string; spaceAfter: boolean }
  | { kind: 'math'; tex: string; text: string; spaceAfter: boolean }

/**
 * A paragraph, list item or heading the mod lays out itself: its list marker,
 * heading level (0 for none), nesting depth (list levels), and whether it is
 * quoted.
 */
export type RichBlock = { marker: string | null; heading: number; depth: number; quote: boolean; runs: Run[] }

export type Align = 'l' | 'c' | 'r'

/** A markdown table the mod draws itself, each cell's text as words and formulas. */
export type TableBlock = { align: Align[]; header: Run[][]; rows: Run[][][] }

export type Block = { md: string } | { rich: RichBlock } | { table: TableBlock }

/** Where a formula left for the mod stands in the converted markdown. */
export const mark = (n: number): string => '' + n + ''

const LIST = /^\s*([-*+]|\d{1,9}[.)])\s+/
const TABLE_ROW = /^\s*(?:>\s?)*\s*\|/
const TABLE_SEP = /^\s*(?:>\s?)*\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/
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

  type Unit = { start: number; end: number; table: boolean }
  const units: Unit[] = []
  let cur: Unit | null = null
  lines.forEach((line, k) => {
    if (line.trim() === '') {
      cur = null
      return
    }
    const bare = line.replace(/^\s*(?:>\s?)*/, '')
    // Consecutive lines that start with a pipe are one table; a table is
    // never part of a paragraph.
    const isRow = TABLE_ROW.test(line)
    if (isRow && cur?.table) {
      cur.end = k + 1
      return
    }
    const heading = HEADING.test(bare)
    if (cur === null || cur.table || isRow || LIST.test(bare) || heading) {
      cur = { start: k, end: k + 1, table: isRow }
      units.push(cur)
      if (heading) cur = null
    } else {
      cur.end = k + 1
    }
  })
  // A run of pipe lines with no separator row second is text, not a table.
  for (const u of units) {
    if (u.table && !(u.end - u.start >= 2 && TABLE_SEP.test(lines[u.start + 1]!))) u.table = false
  }

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
    blocks.push(u.table ? { table: tableBlock(body, inline) } : { rich: richBlock(body, inline) })
    from = u.end
  }
  flush(lines.length)
  return blocks
}

function tableBlock(body: string[], inline: readonly InlineMath[]): TableBlock {
  const cells = (line: string): string[] => {
    let t = line.replace(/^\s*(?:>\s?)*/, '').trim()
    if (t.startsWith('|')) t = t.slice(1)
    if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
    return t.split(/(?<!\\)\|/).map(c => c.trim())
  }
  const align = cells(body[1]!).map((c): Align => (/^:-+:$/.test(c) ? 'c' : /-+:$/.test(c) ? 'r' : 'l'))
  const row = (line: string): Run[][] => cells(line).map(c => parseInline(c, inline))
  return { align, header: row(body[0]!), rows: body.slice(2).map(row) }
}

function richBlock(body: string[], inline: readonly InlineMath[]): RichBlock {
  const quote = /^\s*>/.test(body[0] ?? '')
  const unquoted = body.map(l => l.replace(/^\s*(?:>\s?)*/, ''))
  let first = unquoted[0] ?? ''
  let marker: string | null = null
  let heading = 0
  let depth = 0
  const item = LIST.exec(first)
  if (item) {
    // Nested items are indented by two spaces (bullets) or three (numbers) a level.
    const raw = quote ? (body[0] ?? '').replace(/^\s*(?:>\s?)+/, '') : (body[0] ?? '')
    const spaces = /^\s*/.exec(raw)![0].replace(/\t/g, '    ').length
    depth = Math.floor(spaces / 2)
    marker = /^\d/.test(item[1]!) ? item[1]! : depth % 3 === 1 ? '◦' : depth % 3 === 2 ? '▪' : '•'
    first = first.slice(item[0].length)
  } else if (HEADING.test(first)) {
    heading = /#+/.exec(first)![0].length
    first = first.replace(HEADING, '')
  }
  const text = [first, ...unquoted.slice(1)].map(l => l.trim()).join(' ')
  return { marker, heading, depth, quote, runs: parseInline(text, inline) }
}

type Piece = { text: string; bold: boolean; italic: boolean; strike: boolean; code: boolean; href?: string } | InlineMath

const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** A paragraph's text as words and formulas, each word with its formatting. */
export function parseInline(s: string, inline: readonly InlineMath[]): Run[] {
  const pieces: Piece[] = []
  let bold = false
  let italic = false
  let strike = false
  let buf = ''
  const flush = (): void => {
    if (buf) pieces.push({ text: buf, bold, italic, strike, code: false })
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
        pieces.push({ text: s.slice(i + n, close).trim(), bold, italic, strike, code: true })
        i = close + n
        continue
      }
    }
    if (c === '~' && s[i + 1] === '~') {
      flush()
      strike = !strike
      i += 2
      continue
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
        pieces.push({ text: m[1]!, bold, italic, strike, code: false, href: m[2]! })
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
      runs.push({ kind: 'text', text: p.text.trim(), bold: p.bold, italic: p.italic, strike: p.strike, code: p.code, href: p.href, spaceAfter: /\s$/.test(p.text) })
      continue
    }
    for (const part of p.text.split(/(\s+)/)) {
      if (part === '') continue
      if (/^\s+$/.test(part)) space()
      else runs.push({ kind: 'text', text: part, bold: p.bold, italic: p.italic, strike: p.strike, code: false, spaceAfter: false })
    }
  }
  return runs
}
