// Breaks a display equation too wide for the reply into lines, the way a
// typesetter would: at its top-level relations (=, ≤, →, …) first, then at a
// top-level + or − inside a part still too wide. The lines are set as
// `aligned`, continuation lines indented under the first relation.

const RELATIONS = new Set(
  `= < > le leq ge geq ne neq approx equiv sim simeq cong propto in notin subset subseteq supset supseteq
   to rightarrow leftarrow Rightarrow Leftarrow Leftrightarrow iff implies impliedby mapsto ll gg prec succ
   preceq succeq leqslant geqslant lesssim gtrsim coloneqq triangleq doteq asymp mid`.split(/\s+/),
)

/** A cut of the formula at depth 0: where it starts, and what kind. */
type Cut = { at: number; kind: 'rel' | 'add'; len: number }

/** The formula's top-level relations and binary + / −, skipping groups and environments. */
function cuts(tex: string): Cut[] {
  const out: Cut[] = []
  let depth = 0
  let prevSignificant = ''
  for (let i = 0; i < tex.length; ) {
    const c = tex[i]!
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i))
      const name = m ? m[1]! : ''
      const len = m ? m[0].length : 1
      if (name === 'left' || name === 'begin') depth++
      else if (name === 'right' || name === 'end') depth--
      // A side condition (\quad \text{for } 0 < δ ≤ 1) is kept whole.
      else if (depth === 0 && (name === 'quad' || name === 'qquad')) break
      else if (depth === 0 && RELATIONS.has(name)) out.push({ at: i, kind: 'rel', len })
      prevSignificant = name
      i += len
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (depth === 0 && (c === '=' || c === '<' || c === '>')) out.push({ at: i, kind: 'rel', len: 1 })
    else if (depth === 0 && (c === '+' || c === '-') && prevSignificant !== '' && !/^[=<>+\-(\[,]$/.test(prevSignificant) && !RELATIONS.has(prevSignificant))
      out.push({ at: i, kind: 'add', len: 1 })
    if (!/\s/.test(c)) prevSignificant = c
    i++
  }
  return out
}

/**
 * `tex` as an `aligned` block whose lines each measure at most `maxWidth`, or
 * null when it already fits, or has no place to break, or is a block already.
 */
export function breakLines(tex: string, maxWidth: number, measureTex: (tex: string) => number | null): string | null {
  // A line holds an alignment point, so it is measured inside an aligned block.
  const measure = (body: string): number | null => measureTex('\\begin{aligned}' + body + '\\end{aligned}')
  const whole = measureTex(tex)
  if (whole === null || whole <= maxWidth) return null
  if (/\\\\|\\begin\{|\\tag/.test(tex)) return null
  const all = cuts(tex)
  if (all.length === 0) return null

  const rels = all.filter(c => c.kind === 'rel')
  // With no relation, the first line is the formula's head and the rest hang
  // under it: lhs is empty and every part starts at a + or −.
  const splits = rels.length > 0 ? rels : all
  const lhs = tex.slice(0, splits[0]!.at).trim()
  const parts: string[] = []
  splits.forEach((c, k) => parts.push(tex.slice(c.at, splits[k + 1]?.at ?? tex.length).trim()))

  // Each part too wide by itself is cut again at its own + and −.
  const pieces: { text: string; continued: boolean }[] = []
  for (const part of parts) {
    if ((measure(lhs + part) ?? 0) <= maxWidth || rels.length === 0) {
      pieces.push({ text: part, continued: false })
      continue
    }
    const inner = cuts(part).filter(c => c.kind === 'add' && c.at > 0)
    if (inner.length === 0) {
      pieces.push({ text: part, continued: false })
      continue
    }
    let from = 0
    for (const c of inner) {
      pieces.push({ text: part.slice(from, c.at).trim(), continued: from > 0 })
      from = c.at
    }
    pieces.push({ text: part.slice(from).trim(), continued: true })
  }

  // Greedy fill: a line takes pieces while it still fits.
  const lines: string[] = []
  let line = ''
  const lineTex = (body: string, first: boolean): string => (first ? lhs + ' &' + body : '&' + body)
  for (const p of pieces) {
    const text = p.continued ? '\\quad ' + p.text : p.text
    const candidate = line ? line + ' ' + p.text : text
    const first = lines.length === 0
    if (line && (measure(lineTex(candidate, first)) ?? Infinity) > maxWidth) {
      lines.push(lineTex(line, first))
      line = text
    } else {
      line = candidate
    }
  }
  if (line) lines.push(lineTex(line, lines.length === 0))
  if (lines.length < 2) return null
  return '\\begin{aligned}' + lines.join(' \\\\ ') + '\\end{aligned}'
}
