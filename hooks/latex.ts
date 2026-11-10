// LaTeX math → Unicode text, for markdown that a terminal or chat view draws.
//
// Inline math ($…$, \(…\)) becomes one line of Unicode in the prose. Display
// math ($$…$$, \[…\], \begin{align}…) is typeset in two dimensions (stacked
// fractions, matrices, cases, limits under ∑) and, when it needs more than one
// line, set in a code fence so its columns line up.

import { mark, segment, type InlineMath, type RichBlock, type TableBlock } from './rich'

type Kind = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner' | 'space'
type Box = { lines: string[]; base: number }
type Atom = { kind: Kind; box: Box; limits?: boolean }
type Tok = { t: 'cmd' | 'ch' | 'sp'; v: string }
type Align = 'l' | 'c' | 'r'

// ---------------------------------------------------------------- boxes

const MARK = /\p{M}/u

function cellsOf(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    if (MARK.test(ch) && out.length > 0) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

const sw = (s: string): number => cellsOf(s).length
const bw = (b: Box): number => b.lines.reduce((w, l) => Math.max(w, sw(l)), 0)
const txt = (s: string): Box => ({ lines: [s], base: 0 })
const EMPTY: Box = { lines: [''], base: 0 }
const isFlat = (b: Box): boolean => b.lines.length === 1
const flat = (b: Box): string =>
  b.lines.length === 1
    ? b.lines[0]!
    : b.lines
        .map(l => l.trim())
        .filter(Boolean)
        .join(' ')
const padTo = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - sw(s)))

type Item = { b: Box; x: number; y: number }

// Draws boxes on a canvas; y is the row of a box's top line, row 0 the baseline.
function place(items: Item[], minWidth = 0): Box {
  let top = 0
  let bottom = 0
  let w = minWidth
  for (const { b, x, y } of items) {
    top = Math.min(top, y)
    bottom = Math.max(bottom, y + b.lines.length - 1)
    w = Math.max(w, x + bw(b))
  }
  const rows: string[][] = []
  for (let r = top; r <= bottom; r++) rows.push(Array<string>(w).fill(' '))
  for (const { b, x, y } of items) {
    b.lines.forEach((line, k) => {
      const row = rows[y + k - top]!
      cellsOf(line).forEach((c, j) => {
        if (c !== ' ') row[x + j] = c
      })
    })
  }
  return { lines: rows.map(r => r.join('')), base: -top }
}

function hcat(boxes: Box[]): Box {
  if (boxes.every(isFlat)) return txt(boxes.map(b => b.lines[0]!).join(''))
  const items: Item[] = []
  let x = 0
  for (const b of boxes) {
    items.push({ b, x, y: -b.base })
    x += bw(b)
  }
  return place(items, x)
}

function vstack(boxes: Box[], baseIndex: number, align: 'l' | 'c' = 'c'): Box {
  const W = boxes.reduce((w, b) => Math.max(w, bw(b)), 0)
  const items: Item[] = []
  let y = 0
  let baseRow = 0
  boxes.forEach((b, k) => {
    if (k === baseIndex) baseRow = y + b.base
    items.push({ b, x: align === 'c' ? Math.floor((W - bw(b)) / 2) : 0, y })
    y += b.lines.length
  })
  return place(
    items.map(it => ({ ...it, y: it.y - baseRow })),
    W,
  )
}

const TALL: Record<string, [string, string, string]> = {
  '(': ['⎛', '⎜', '⎝'],
  ')': ['⎞', '⎟', '⎠'],
  '[': ['⎡', '⎢', '⎣'],
  ']': ['⎤', '⎥', '⎦'],
  '⌊': ['⎢', '⎢', '⎣'],
  '⌋': ['⎥', '⎥', '⎦'],
  '⌈': ['⎡', '⎢', '⎢'],
  '⌉': ['⎤', '⎥', '⎥'],
  '|': ['│', '│', '│'],
  '∣': ['│', '│', '│'],
  '‖': ['‖', '‖', '‖'],
}

function tall(ch: string, h: number, base: number): Box {
  const lines: string[] = []
  if (ch === '') {
    for (let k = 0; k < h; k++) lines.push('')
  } else if (ch === '{' || ch === '}') {
    const [t, m, b, e] = ch === '{' ? ['⎧', '⎨', '⎩', '⎪'] : ['⎫', '⎬', '⎭', '⎪']
    const mid = h === 2 ? -1 : Math.min(h - 2, Math.max(1, base))
    for (let k = 0; k < h; k++) lines.push(k === 0 ? t : k === h - 1 ? b : k === mid ? m : e)
  } else if (ch === '⟨' || ch === '⟩') {
    for (let k = 0; k < h; k++) {
      const up = 2 * k + 1 < h
      const mid = 2 * k + 1 === h
      lines.push(mid ? ch : up === (ch === '⟨') ? '╱' : '╲')
    }
  } else {
    const s = TALL[ch]
    for (let k = 0; k < h; k++) lines.push(s ? (k === 0 ? s[0] : k === h - 1 ? s[2] : s[1]) : ch)
  }
  return { lines, base }
}

function delimited(c: Box, l: string, r: string): Box {
  if (isFlat(c)) return txt(l + c.lines[0]! + r)
  const h = c.lines.length
  return hcat([tall(l, h, c.base), c, tall(r, h, c.base)])
}

function grid(rows: Box[][], align: (c: number) => Align, gap: (c: number) => string): Box {
  const ncols = rows.reduce((n, r) => Math.max(n, r.length), 0)
  const widths: number[] = Array<number>(ncols).fill(0)
  for (const r of rows) r.forEach((b, c) => (widths[c] = Math.max(widths[c]!, bw(b))))
  const rowBoxes = rows.map(r => {
    const items: Item[] = []
    let x = 0
    for (let c = 0; c < ncols; c++) {
      const b = r[c] ?? EMPTY
      const w = widths[c]!
      const a = align(c)
      const off = a === 'l' ? 0 : a === 'r' ? w - bw(b) : Math.floor((w - bw(b)) / 2)
      items.push({ b, x: x + off, y: -b.base })
      x += w
      if (c < ncols - 1) x += sw(gap(c))
    }
    return place(items, x)
  })
  if (rowBoxes.length === 1) return rowBoxes[0]!
  const spaced = rowBoxes.some(b => b.lines.length > 1)
  const parts: Box[] = []
  rowBoxes.forEach((b, k) => {
    if (k > 0 && spaced) parts.push(EMPTY)
    parts.push(b)
  })
  const out = vstack(parts, 0, 'l')
  return { lines: out.lines, base: Math.floor((out.lines.length - 1) / 2) }
}

function stackedFrac(n: Box, d: Box): Box {
  const W = Math.max(bw(n), bw(d)) + 2
  return vstack([n, txt('─'.repeat(W)), d], 1)
}

function sqrt2d(r: Box, idx: string): Box {
  const w = bw(r)
  const h = r.lines.length
  const L = sw(idx)
  const lines = [idx + ' ' + '_'.repeat(w)]
  r.lines.forEach((l, k) => lines.push(' '.repeat(L) + (k === h - 1 ? '√' : '│') + l))
  return { lines, base: 1 + r.base }
}

function frame(b: Box): Box {
  const w = bw(b)
  return {
    lines: ['┌' + '─'.repeat(w + 2) + '┐', ...b.lines.map(l => '│ ' + padTo(l, w) + ' │'), '└' + '─'.repeat(w + 2) + '┘'],
    base: b.base + 1,
  }
}

function braceRow(w: number, under: boolean): string {
  if (w <= 1) return under ? '‿' : '⁀'
  if (w === 2) return under ? '╰╯' : '╭╮'
  const mid = Math.floor((w - 1) / 2)
  const [l, m, r] = under ? ['╰', '┬', '╯'] : ['╭', '┴', '╮']
  return l + '─'.repeat(mid - 1) + m + '─'.repeat(w - mid - 2) + r
}

// ---------------------------------------------------------------- tables

const SYM: Record<string, [Kind, string]> = {}
const LIMITS = new Set<string>()
const CHAR_KIND = new Map<string, Kind>()

function add(kind: Kind, pairs: string): void {
  const p = pairs.trim().split(/\s+/)
  for (let k = 0; k + 1 < p.length; k += 2) {
    SYM[p[k]!] = [kind, p[k + 1]!]
    if (kind !== 'ord' && kind !== 'op' && !CHAR_KIND.has(p[k + 1]!)) CHAR_KIND.set(p[k + 1]!, kind)
  }
}

add(
  'ord',
  `alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ
   iota ι kappa κ varkappa ϰ lambda λ mu μ nu ν xi ξ omicron ο pi π varpi ϖ rho ρ varrho ϱ
   sigma σ varsigma ς tau τ upsilon υ phi ϕ varphi φ chi χ psi ψ omega ω digamma ϝ
   Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω
   varGamma Γ varDelta Δ varTheta Θ varLambda Λ varXi Ξ varPi Π varSigma Σ varPhi Φ varPsi Ψ varOmega Ω
   infty ∞ partial ∂ nabla ∇ forall ∀ exists ∃ nexists ∄ neg ¬ lnot ¬ emptyset ∅ varnothing ∅
   aleph ℵ beth ℶ gimel ℷ hbar ℏ hslash ℏ ell ℓ Re ℜ Im ℑ wp ℘ top ⊤ bot ⊥ angle ∠
   measuredangle ∡ triangle △ square □ Box □ blacksquare ■ checkmark ✓ prime ′ backprime ‵ degree °
   ldots … dots … dotsc … dotso … cdots ⋯ dotsb ⋯ dotsm ⋯ dotsi ⋯ vdots ⋮ ddots ⋱ iddots ⋰
   S § P ¶ clubsuit ♣ diamondsuit ♢ heartsuit ♡ spadesuit ♠ flat ♭ sharp ♯ natural ♮ mho ℧
   eth ð complement ∁ surd √ backslash \\ imath ı jmath ȷ vert | Vert ‖ | ‖ lozenge ◊
   blacklozenge ⧫ bigstar ★ qed ∎ Finv Ⅎ Game ⅁ varkappa ϰ diagup ╱ diagdown ╲ _ _ % % # # & & $ $
   AA Å aa å O Ø o ø ss ß ae æ AE Æ copyright © pounds £ euro €`,
)
add(
  'open',
  `( ( [ [ lbrace { lbrack [ langle ⟨ lfloor ⌊ lceil ⌈ lvert | lVert ‖ ulcorner ⌜ llcorner ⌞
   lgroup ⟮ llbracket ⟦ lparen (`,
)
SYM['{'] = ['open', '{']
add(
  'close',
  `rbrace } rbrack ] rangle ⟩ rfloor ⌋ rceil ⌉ rvert | rVert ‖ urcorner ⌝ lrcorner ⌟
   rgroup ⟯ rrbracket ⟧ rparen )`,
)
SYM['}'] = ['close', '}']
add('punct', `colon : ldotp . cdotp ·`)
add(
  'bin',
  `pm ± mp ∓ times × div ÷ cdot · ast ∗ star ⋆ circ ∘ bullet ∙ oplus ⊕ ominus ⊖ otimes ⊗
   oslash ⊘ odot ⊙ cup ∪ cap ∩ sqcup ⊔ sqcap ⊓ setminus ∖ smallsetminus ∖ wedge ∧ land ∧
   vee ∨ lor ∨ uplus ⊎ amalg ⨿ wr ≀ diamond ⋄ triangleleft ◁ triangleright ▷ lhd ⊲ rhd ⊳
   unlhd ⊴ unrhd ⊵ dagger † ddagger ‡ bigtriangleup △ bigtriangledown ▽ boxplus ⊞ boxminus ⊟
   boxtimes ⊠ boxdot ⊡ ltimes ⋉ rtimes ⋊ dotplus ∔ intercal ⊺ divideontimes ⋇ curlywedge ⋏
   curlyvee ⋎ barwedge ⊼ veebar ⊻ centerdot · bmod mod mod mod`,
)
add(
  'rel',
  `leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ approx ≈ approxeq ≊ equiv ≡ sim ∼ simeq ≃ cong ≅ propto ∝
   in ∈ notin ∉ ni ∋ owns ∋ subset ⊂ subseteq ⊆ supset ⊃ supseteq ⊇ subsetneq ⊊ supsetneq ⊋
   nsubseteq ⊈ nsupseteq ⊉ sqsubset ⊏ sqsupset ⊐ sqsubseteq ⊑ sqsupseteq ⊒
   to → rightarrow → leftarrow ← gets ← Rightarrow ⇒ Leftarrow ⇐ Leftrightarrow ⇔
   leftrightarrow ↔ iff ⟺ implies ⟹ impliedby ⟸ mapsto ↦ longmapsto ⟼ longrightarrow ⟶
   longleftarrow ⟵ Longrightarrow ⟹ Longleftarrow ⟸ Longleftrightarrow ⟺ longleftrightarrow ⟷
   hookrightarrow ↪ hookleftarrow ↩ twoheadrightarrow ↠ twoheadleftarrow ↞ rightharpoonup ⇀
   rightharpoondown ⇁ leftharpoonup ↼ leftharpoondown ↽ rightleftharpoons ⇌ leftrightharpoons ⇋
   rightrightarrows ⇉ leftleftarrows ⇇ rightleftarrows ⇄ leftrightarrows ⇆ uparrow ↑ downarrow ↓
   updownarrow ↕ Uparrow ⇑ Downarrow ⇓ Updownarrow ⇕ nearrow ↗ searrow ↘ swarrow ↙ nwarrow ↖
   leadsto ⇝ rightsquigarrow ⇝ circlearrowleft ↺ circlearrowright ↻ curvearrowleft ↶ curvearrowright ↷
   nrightarrow ↛ nleftarrow ↚ nRightarrow ⇏ nLeftarrow ⇍ nleftrightarrow ↮ nLeftrightarrow ⇎
   perp ⊥ parallel ∥ nparallel ∦ mid ∣ nmid ∤ vdash ⊢ dashv ⊣ models ⊨ vDash ⊨ Vdash ⊩ nvdash ⊬
   nvDash ⊭ ll ≪ gg ≫ lll ⋘ ggg ⋙ prec ≺ succ ≻ preceq ⪯ succeq ⪰ asymp ≍ doteq ≐ lesssim ≲
   gtrsim ≳ leqslant ⩽ geqslant ⩾ leqq ≦ geqq ≧ triangleq ≜ coloneqq ≔ eqqcolon ≕ coloneq ≔
   ncong ≇ nsim ≁ nleq ≰ ngeq ≱ nless ≮ ngtr ≯ lneq ⪇ gneq ⪈ therefore ∴ because ∵ bowtie ⋈
   Join ⋈ smile ⌣ frown ⌢ vartriangleleft ⊲ vartriangleright ⊳ trianglelefteq ⊴
   trianglerighteq ⊵ circeq ≗ eqcirc ≖ bumpeq ≏ Bumpeq ≎ risingdotseq ≓ fallingdotseq ≒
   backsim ∽ backsimeq ⋍ multimap ⊸ pitchfork ⋔ lessgtr ≶ gtrless ≷ prec ≺ sqsubsetneq ⊏
   Subset ⋐ Supset ⋑ dashrightarrow ⇢ dashleftarrow ⇠ longleftrightarrows ⇆`,
)
add(
  'op',
  `sum ∑ prod ∏ coprod ∐ bigcup ⋃ bigcap ⋂ bigoplus ⨁ bigotimes ⨂ bigodot ⨀ bigvee ⋁
   bigwedge ⋀ biguplus ⨄ bigsqcup ⨆ int ∫ iint ∬ iiint ∭ iiiint ⨌ oint ∮ oiint ∯ idotsint ∫⋯∫`,
)
for (const n of 'sum prod coprod bigcup bigcap bigoplus bigotimes bigodot bigvee bigwedge biguplus bigsqcup'.split(' '))
  LIMITS.add(n)
for (const [c, k] of [
  ['=', 'rel'],
  ['<', 'rel'],
  ['>', 'rel'],
  [':', 'rel'],
  ['+', 'bin'],
  ['−', 'bin'],
  ['∗', 'bin'],
  [',', 'punct'],
  [';', 'punct'],
  ['(', 'open'],
  ['[', 'open'],
  [')', 'close'],
  [']', 'close'],
  ['!', 'close'],
  ['?', 'close'],
  ['|', 'ord'],
  ['‖', 'ord'],
] as const)
  CHAR_KIND.set(c, k)

const FUNCS: Record<string, [string, boolean]> = {}
for (const n of `arccos arcsin arctan arccot arcsec arccsc arg cos cosh cot coth csc csch deg dim exp hom ker lg ln log
  sec sech sin sinh tan tanh sgn tr Tr rank diag span erf erfc Var Cov cov sign ord id im`.split(/\s+/))
  FUNCS[n] = [n, false]
for (const n of 'det gcd lcm inf lim max min Pr sup argmax argmin esssup essinf'.split(' ')) FUNCS[n] = [n, true]
FUNCS.liminf = ['lim inf', true]
FUNCS.limsup = ['lim sup', true]
FUNCS.injlim = ['inj lim', true]
FUNCS.projlim = ['proj lim', true]

const SPACES: Record<string, string> = {
  ',': ' ',
  ':': ' ',
  ';': ' ',
  '>': ' ',
  ' ': ' ',
  '!': '',
  quad: ' ',
  qquad: '  ',
  enspace: ' ',
  enskip: ' ',
  thinspace: ' ',
  medspace: ' ',
  thickspace: ' ',
  space: ' ',
  negthinspace: '',
  negmedspace: '',
  negthickspace: '',
}

const ACCENTS: Record<string, string> = {
  hat: '̂',
  widehat: '̂',
  check: '̌',
  widecheck: '̌',
  tilde: '̃',
  widetilde: '̃',
  acute: '́',
  grave: '̀',
  dot: '̇',
  ddot: '̈',
  dddot: '⃛',
  breve: '̆',
  bar: '̄',
  overline: '̅',
  widebar: '̅',
  underline: '̲',
  underbar: '̲',
  vec: '⃗',
  overrightarrow: '⃗',
  overleftarrow: '⃖',
  overleftrightarrow: '⃡',
  mathring: '̊',
  utilde: '̰',
  cancel: '̶',
  bcancel: '̶',
  xcancel: '̶',
  sout: '̶',
}

const NEG: Record<string, string> = {
  '=': '≠',
  '∈': '∉',
  '∋': '∌',
  '≤': '≰',
  '≥': '≱',
  '<': '≮',
  '>': '≯',
  '⊂': '⊄',
  '⊃': '⊅',
  '⊆': '⊈',
  '⊇': '⊉',
  '∃': '∄',
  '≡': '≢',
  '∼': '≁',
  '≈': '≉',
  '∣': '∤',
  '≅': '≇',
  '≃': '≄',
  '∥': '∦',
  '⊢': '⊬',
  '⊨': '⊭',
  '→': '↛',
  '←': '↚',
  '↔': '↮',
  '⇒': '⇏',
  '⇔': '⇎',
  '≺': '⊀',
  '≻': '⊁',
}

type Font = { A?: number; a?: number; d?: number; GA?: number; ga?: number; ex?: Record<string, string> }
const FONT: Record<string, Font> = {
  bf: { A: 0x1d400, a: 0x1d41a, d: 0x1d7ce, GA: 0x1d6a8, ga: 0x1d6c2 },
  it: { A: 0x1d434, a: 0x1d44e, GA: 0x1d6e2, ga: 0x1d6fc, ex: { h: 'ℎ' } },
  bi: { A: 0x1d468, a: 0x1d482, d: 0x1d7ce, GA: 0x1d71c, ga: 0x1d736 },
  cal: {
    A: 0x1d49c,
    a: 0x1d4b6,
    ex: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
  },
  frak: { A: 0x1d504, a: 0x1d51e, ex: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' } },
  bb: { A: 0x1d538, a: 0x1d552, d: 0x1d7d8, ex: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' } },
  sf: { A: 0x1d5a0, a: 0x1d5ba, d: 0x1d7e2 },
  tt: { A: 0x1d670, a: 0x1d68a, d: 0x1d7f6 },
  rm: {},
}
const FONT_CMDS: Record<string, string> = {
  mathbb: 'bb',
  Bbb: 'bb',
  mathbbm: 'bb',
  mathds: 'bb',
  mathcal: 'cal',
  mathscr: 'cal',
  cal: 'cal',
  mathfrak: 'frak',
  frak: 'frak',
  mathbf: 'bf',
  bold: 'bf',
  bf: 'bf',
  boldsymbol: 'bi',
  bm: 'bi',
  pmb: 'bi',
  mathit: 'it',
  it: 'it',
  mathsf: 'sf',
  sf: 'sf',
  mathtt: 'tt',
  tt: 'tt',
  mathrm: 'rm',
  mathnormal: 'rm',
  mathup: 'rm',
  rm: 'rm',
}
const TEXT_CMDS: Record<string, string> = {
  text: 'rm',
  textrm: 'rm',
  textnormal: 'rm',
  textup: 'rm',
  textmd: 'rm',
  textsl: 'rm',
  mbox: 'rm',
  hbox: 'rm',
  textsf: 'sf',
  texttt: 'tt',
  textit: 'it',
  emph: 'it',
  textbf: 'bf',
  intertext: 'rm',
}

function mapFont(s: string, f: Font): string {
  let out = ''
  for (const ch of s) {
    const e = f.ex?.[ch]
    if (e) {
      out += e
      continue
    }
    const c = ch.codePointAt(0)!
    if (c >= 65 && c <= 90 && f.A) out += String.fromCodePoint(f.A + c - 65)
    else if (c >= 97 && c <= 122 && f.a) out += String.fromCodePoint(f.a + c - 97)
    else if (c >= 48 && c <= 57 && f.d) out += String.fromCodePoint(f.d + c - 48)
    else if (c >= 0x391 && c <= 0x3a9 && f.GA) out += String.fromCodePoint(f.GA + c - 0x391)
    else if (c >= 0x3b1 && c <= 0x3c9 && f.ga) out += String.fromCodePoint(f.ga + c - 0x3b1)
    else out += ch
  }
  return out
}

function pairs(s: string): Map<string, string> {
  const cs = [...s]
  const m = new Map<string, string>()
  for (let k = 0; k + 1 < cs.length; k += 2) m.set(cs[k]!, cs[k + 1]!)
  return m
}
const SUP = pairs(
  '0⁰1¹2²3³4⁴5⁵6⁶7⁷8⁸9⁹+⁺−⁻-⁻=⁼(⁽)⁾aᵃbᵇcᶜdᵈeᵉfᶠgᵍhʰiⁱjʲkᵏlˡmᵐnⁿoᵒpᵖrʳsˢtᵗuᵘvᵛwʷxˣyʸzᶻ' +
    'AᴬBᴮDᴰEᴱGᴳHᴴIᴵJᴶKᴷLᴸMᴹNᴺOᴼPᴾRᴿTᵀUᵁVⱽWᵂαᵅβᵝγᵞδᵟεᵋϵᵋθᶿιᶥφᵠϕᵠχᵡ∘°°°⊤ᵀ′′″″‴‴††‡‡',
)
SUP.set('∗', '*').set('*', '*').set('/', 'ᐟ').set('.', '·')
const SUB = pairs('0₀1₁2₂3₃4₄5₅6₆7₇8₈9₉+₊−₋-₋=₌(₍)₎aₐeₑhₕiᵢjⱼkₖlₗmₘnₙoₒpₚrᵣsₛtₜuᵤvᵥxₓβᵦγᵧρᵨφᵩϕᵩχᵪ')

function toScript(s: string, map: Map<string, string>): string | null {
  let out = ''
  for (const c of s.replace(/\s+/g, '')) {
    const m = map.get(c)
    if (m === undefined) return null
    out += m
  }
  return out
}

const VULGAR: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/5': '⅕',
  '2/5': '⅖',
  '3/5': '⅗',
  '4/5': '⅘',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/7': '⅐',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
  '1/9': '⅑',
  '1/10': '⅒',
}

// A linear piece that reads as one unit beside a "/": "x²", "f(x+1)", "(a+b)".
function isAtomic(s: string): boolean {
  const cs = cellsOf(s)
  if (cs.length <= 1) return true
  let depth = 0
  for (const c of cs) {
    if ('([{⟨'.includes(c)) depth++
    else if (')]}⟩'.includes(c)) depth--
    else if (depth === 0 && !/^[\p{L}\p{N}′″‴°!.√∞∂_^]/u.test(c)) return false
  }
  return true
}
const wrap = (s: string): string => (isAtomic(s) ? s : '(' + s + ')')

function textify(raw: string): string {
  let s = raw.replace(/\\\$/g, '').replace(/\\\{/g, '').replace(/\\\}/g, '')
  s = s.replace(/\$([^$]+)\$/g, (m, body: string) => {
    try {
      return texToLines(body, false).join(' ')
    } catch {
      return m
    }
  })
  s = s.replace(/\\([,;:! ])/g, (_m, c: string) => (c === '!' ? '' : ' ')).replace(/~/g, ' ')
  s = s.replace(/\\([%&#_])/g, '$1')
  s = s.replace(/\\([A-Za-z]+)(\s*)/g, (m, n: string, space: string) => {
    if (n in TEXT_CMDS || n in FONT_CMDS) return ''
    if (n === 'quad') return ' '
    if (n === 'qquad') return '  '
    const sym = SYM[n]
    return sym ? sym[1] + space : m
  })
  s = s
    .replace(/[{}]/g, '')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``|''/g, '"')
  return s.replace(//g, '{').replace(//g, '}').replace(//g, '$')
}

// ---------------------------------------------------------------- lexer

function lex(src: string): Tok[] {
  const out: Tok[] = []
  const word = /[A-Za-z]+/y
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\') {
      word.lastIndex = i + 1
      const m = word.exec(src)
      if (m) {
        out.push({ t: 'cmd', v: m[0] })
        i += 1 + m[0].length
        continue
      }
      if (i + 1 < src.length) {
        const ch = String.fromCodePoint(src.codePointAt(i + 1)!)
        out.push({ t: 'cmd', v: ch })
        i += 1 + ch.length
        continue
      }
      out.push({ t: 'ch', v: '\\' })
      i++
      continue
    }
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i]!)) i++
      out.push({ t: 'sp', v: ' ' })
      continue
    }
    const ch = String.fromCodePoint(src.codePointAt(i)!)
    out.push({ t: 'ch', v: ch })
    i += ch.length
  }
  return out
}

// ---------------------------------------------------------------- parser

const sp = (s: string): Atom => ({ kind: 'space', box: txt(s) })

function gap(p: Kind, c: Kind): boolean {
  if (c === 'rel') return p !== 'open' && p !== 'rel' && p !== 'punct'
  if (p === 'rel') return c !== 'close' && c !== 'punct'
  if (c === 'bin' || p === 'bin') return true
  if (p === 'punct') return c !== 'close'
  if (p === 'op') return c === 'ord' || c === 'op'
  if (c === 'op') return p === 'ord' || p === 'close' || p === 'inner'
  return false
}

function layout(atoms: Atom[], lead: boolean, tight: boolean): Box {
  const parts: Box[] = []
  let prev: Kind | null = lead ? 'ord' : null
  atoms.forEach((a, k) => {
    let kind = a.kind
    if (kind === 'bin') {
      const nx = atoms[k + 1]?.kind
      if (
        prev === null ||
        prev === 'bin' ||
        prev === 'op' ||
        prev === 'rel' ||
        prev === 'open' ||
        prev === 'punct' ||
        nx === undefined ||
        nx === 'rel' ||
        nx === 'close' ||
        nx === 'punct'
      )
        kind = 'ord'
    }
    if (!tight && prev !== null && prev !== 'space' && kind !== 'space' && gap(prev, kind)) parts.push(txt(' '))
    parts.push(a.box)
    prev = kind
  })
  return parts.length > 0 ? hcat(parts) : EMPTY
}

const MATRIX: Record<string, [string, string]> = {
  matrix: ['', ''],
  smallmatrix: ['', ''],
  array: ['', ''],
  subarray: ['', ''],
  pmatrix: ['(', ')'],
  psmallmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  bsmallmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  vsmallmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  cases: ['{', ''],
  dcases: ['{', ''],
  rcases: ['', '}'],
}
const ALIGNED = new Set(['align', 'aligned', 'split', 'eqnarray', 'alignat', 'alignedat', 'flalign'])

const ARROWS: Record<string, [string, string, boolean]> = {
  xrightarrow: ['─', '→', false],
  xleftarrow: ['─', '←', true],
  xRightarrow: ['═', '⇒', false],
  xLeftarrow: ['═', '⇐', true],
  xleftrightarrow: ['─', '↔', false],
  xLeftrightarrow: ['═', '⇔', false],
  xmapsto: ['─', '↦', false],
  xhookrightarrow: ['─', '↪', false],
  xlongequal: ['═', '═', false],
}

const NULL_CMDS = new Set([
  'nonumber',
  'notag',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
  'limits',
  'nolimits',
  'hline',
  'mathstrut',
  'strut',
  'relax',
  'allowbreak',
  'nobreak',
  'centering',
  'normalsize',
  'small',
  'large',
  'Large',
  'tiny',
  'huge',
  'Huge',
  'scriptsize',
  'footnotesize',
])

class Parser {
  private i = 0
  private depth = 0
  private tight = false

  private readonly toks: Tok[]
  private display: boolean
  // Letters drawn in math italic (𝑥), as TeX sets a variable.
  private italic: boolean
  // A subscript or superscript with no Unicode form was written linearly; a
  // second pass writes every one of that kind linearly, so a formula reads
  // F_a + F_b rather than Fₐ + F_b.
  subFailed = false
  supFailed = false
  forceLinearSub = false
  forceLinearSup = false

  constructor(toks: Tok[], display: boolean, italic = false) {
    this.toks = toks
    this.display = display
    this.italic = italic
  }

  private upright<T>(f: () => T): T {
    const it = this.italic
    this.italic = false
    try {
      return f()
    } finally {
      this.italic = it
    }
  }

  private peek(): Tok | undefined {
    while (this.toks[this.i]?.t === 'sp') this.i++
    return this.toks[this.i]
  }

  private next(): Tok | undefined {
    const t = this.peek()
    if (t) this.i++
    return t
  }

  private isCh(v: string): boolean {
    const t = this.peek()
    return t?.t === 'ch' && t.v === v
  }

  private mode<T>(display: boolean, tight: boolean, f: () => T): T {
    const d = this.display
    const t = this.tight
    this.display = display
    this.tight = tight
    try {
      return f()
    } finally {
      this.display = d
      this.tight = t
    }
  }

  private script<T>(f: () => T): T {
    return this.upright(() => this.mode(false, true, f))
  }

  top(): Box {
    const rows = this.body(null, true)
    if (rows.length === 1 && rows[0]!.length === 1) return rows[0]![0]!
    if (!this.display) return txt(rows.map(r => r.map(flat).join('')).join('; '))
    const amp = rows.some(r => r.length > 1)
    return amp ? this.alignGrid(rows) : grid(rows, () => 'c', () => '  ')
  }

  private alignGrid(rows: Box[][]): Box {
    return grid(
      rows,
      c => (c % 2 === 0 ? 'r' : 'l'),
      c => (c % 2 === 1 ? '  ' : ''),
    )
  }

  private body(env: string | null, lead: boolean): Box[][] {
    const rows: Box[][] = [[]]
    const stops = env === null ? ['&', '\\\\'] : ['&', '\\\\', '\\end']
    for (;;) {
      const row = rows[rows.length - 1]!
      row.push(this.seq(stops, lead && row.length % 2 === 1))
      const t = this.next()
      if (!t) break
      if (t.t === 'ch' && t.v === '&') continue
      if (t.t === 'cmd' && t.v === '\\') {
        this.skipDimen()
        rows.push([])
        continue
      }
      if (t.t === 'cmd' && t.v === 'end') {
        this.rawArg()
        break
      }
    }
    const last = rows[rows.length - 1]!
    if (rows.length > 1 && last.length <= 1 && (last[0] === undefined || bw(last[0]) === 0)) rows.pop()
    return rows
  }

  // `\\[4pt]`: a row's extra height, which a text grid has no use for.
  private skipDimen(): void {
    const t = this.toks[this.i]
    if (t?.t !== 'ch' || t.v !== '[') return
    let k = this.i + 1
    while (k < this.toks.length && k < this.i + 12) {
      const u = this.toks[k]!
      if (u.t === 'ch' && u.v === ']') {
        this.i = k + 1
        return
      }
      if (u.t !== 'ch' || !/[\w.\-]/.test(u.v)) return
      k++
    }
  }

  seq(stops: string[], lead = false): Box {
    return layout(this.seqAtoms(stops), lead, this.tight)
  }

  private seqAtoms(stops: string[]): Atom[] {
    const atoms: Atom[] = []
    for (;;) {
      const t = this.peek()
      if (!t) break
      const key = t.t === 'cmd' ? '\\' + t.v : t.v
      if (stops.includes(key)) break
      if (t.t === 'ch' && t.v === '}') {
        this.i++
        continue
      }
      if (t.t === 'cmd' && (t.v === 'over' || t.v === 'choose' || t.v === 'atop')) {
        this.i++
        const num = layout(atoms, false, this.tight)
        const den = this.seq(stops)
        const box = t.v === 'over' ? this.frac(num, den, this.display) : this.binom(num, den, this.display, t.v === 'choose')
        return [{ kind: 'ord', box }]
      }
      const a =
        t.t === 'ch' && (t.v === '^' || t.v === '_' || t.v === "'") ? { kind: 'ord' as const, box: EMPTY } : this.atom()
      if (a) atoms.push(this.scripts(a))
    }
    return atoms
  }

  private scripts(a: Atom): Atom {
    let sup: string | null = null
    let sub: string | null = null
    let primes = ''
    let limits = a.limits ?? false
    for (;;) {
      const t = this.peek()
      if (!t) break
      if (t.t === 'ch' && t.v === "'") {
        this.i++
        primes += '′'
        continue
      }
      if (t.t === 'cmd' && (t.v === 'limits' || t.v === 'nolimits')) {
        this.i++
        limits = t.v === 'limits'
        continue
      }
      if (t.t === 'ch' && (t.v === '^' || t.v === '_')) {
        this.i++
        const s = this.script(() => flat(this.arg().box))
        if (t.v === '^') sup = (sup ?? '') + s
        else sub = (sub ?? '') + s
        continue
      }
      break
    }
    const box = primes ? hcat([a.box, txt(primes)]) : a.box
    if (sup === null && sub === null) return { ...a, box }
    if (limits && this.display) {
      const parts: Box[] = []
      let bi = 0
      if (sup !== null) {
        parts.push(txt(sup))
        bi = 1
      }
      parts.push(box)
      if (sub !== null) parts.push(txt(sub))
      return { kind: a.kind, box: vstack(parts, bi) }
    }
    let su = sup === null ? '' : toScript(sup, SUP)
    let sb = sub === null ? '' : toScript(sub, SUB)
    if (su === null) this.supFailed = true
    if (sb === null) this.subFailed = true
    if (sup !== null && this.forceLinearSup) su = null
    if (sub !== null && this.forceLinearSub) sb = null
    if (su !== null && sb !== null) return { kind: a.kind, box: hcat([box, txt(sb + su)]) }
    if (this.display && (box.lines.length > 1 || a.kind === 'op')) {
      const h = box.lines.length
      const w = bw(box)
      const items: Item[] = [{ b: box, x: 0, y: -box.base }]
      if (sup !== null) items.push({ b: txt(sup), x: w, y: h > 1 ? -box.base : -1 })
      if (sub !== null) items.push({ b: txt(sub), x: w, y: h > 1 ? h - 1 - box.base : 1 })
      return { kind: a.kind, box: place(items) }
    }
    const lin = (s: string, u: string | null, mark: string): string =>
      u ?? mark + (cellsOf(s).length === 1 ? s : '(' + s + ')')
    const tail = (sub === null ? '' : lin(sub, sb, '_')) + (sup === null ? '' : lin(sup, su, '^'))
    return { kind: a.kind, box: hcat([box, txt(tail)]) }
  }

  private arg(): Atom {
    const t = this.peek()
    if (!t || (t.t === 'ch' && t.v === '}')) return { kind: 'ord', box: EMPTY }
    if (t.t === 'ch' && t.v === '{') {
      this.i++
      const atoms = this.seqAtoms(['}'])
      if (this.isCh('}')) this.i++
      if (atoms.length === 1) return atoms[0]!
      return { kind: 'ord', box: layout(atoms, false, this.tight) }
    }
    return this.atom() ?? { kind: 'ord', box: EMPTY }
  }

  private rawArg(): string {
    const t = this.peek()
    if (!t) return ''
    if (t.t === 'ch' && t.v === '{') {
      this.i++
      let depth = 1
      let out = ''
      while (this.i < this.toks.length) {
        const u = this.toks[this.i++]!
        if (u.t === 'ch' && u.v === '{') depth++
        else if (u.t === 'ch' && u.v === '}' && --depth === 0) break
        out += u.t === 'cmd' ? '\\' + u.v : u.v
      }
      return out
    }
    this.i++
    return t.t === 'cmd' ? '\\' + t.v : t.v
  }

  private optRaw(): string | null {
    if (!this.isCh('[')) return null
    this.i++
    let depth = 0
    let out = ''
    while (this.i < this.toks.length) {
      const u = this.toks[this.i++]!
      if (u.t === 'ch' && u.v === '{') depth++
      if (u.t === 'ch' && u.v === '}') depth--
      if (u.t === 'ch' && u.v === ']' && depth <= 0) break
      out += u.t === 'cmd' ? '\\' + u.v + ' ' : u.v
    }
    return out
  }

  private delim(): string {
    const t = this.next()
    if (!t) return ''
    if (t.t === 'ch') return t.v === '.' ? '' : t.v === '<' ? '⟨' : t.v === '>' ? '⟩' : t.v
    return SYM[t.v]?.[1] ?? ''
  }

  private frac(n: Box, d: Box, display: boolean): Box {
    if (isFlat(n) && isFlat(d)) {
      const v = VULGAR[flat(n).trim() + '/' + flat(d).trim()]
      if (v) return txt(v)
    }
    if (display) return stackedFrac(n, d)
    return txt(wrap(flat(n)) + '/' + wrap(flat(d)))
  }

  private binom(n: Box, k: Box, display: boolean, parens = true): Box {
    if (display) {
      const g = grid([[n], [k]], () => 'c', () => '')
      return parens ? delimited(g, '(', ')') : g
    }
    return txt(parens ? 'C(' + flat(n) + ', ' + flat(k) + ')' : flat(n) + ' / ' + flat(k))
  }

  private atom(): Atom | null {
    if (++this.depth > 400) throw new Error('nested too deep')
    try {
      const t = this.next()
      if (!t) return null
      if (t.t === 'ch') return this.charAtom(t.v)
      if (t.t === 'cmd') return this.command(t.v)
      return null
    } finally {
      this.depth--
    }
  }

  private charAtom(c: string): Atom | null {
    switch (c) {
      case '{': {
        const atoms = this.seqAtoms(['}'])
        if (this.isCh('}')) this.i++
        return { kind: 'ord', box: layout(atoms, false, this.tight) }
      }
      case '~':
        return sp(' ')
      case '&':
        return sp(' ')
      case '-':
        return { kind: 'bin', box: txt('−') }
      case '*':
        return { kind: 'bin', box: txt('∗') }
      case "'":
        return { kind: 'ord', box: txt('′') }
      default:
        return {
          kind: CHAR_KIND.get(c) ?? 'ord',
          box: txt(this.italic && /^[A-Za-z]$/.test(c) ? mapFont(c, FONT.it!) : c),
        }
    }
  }

  private fontArg(font: string): Atom {
    const a = this.upright(() => this.arg())
    const f = FONT[font] ?? {}
    return { kind: a.kind === 'op' ? 'op' : 'ord', box: { lines: a.box.lines.map(l => mapFont(l, f)), base: a.box.base } }
  }

  private command(n: string): Atom | null {
    const s = SYM[n]
    if (s) {
      const cp = s[1].codePointAt(0)!
      const glyph = this.italic && s[0] === 'ord' && s[1].length === 1 && cp >= 0x3b1 && cp <= 0x3c9 ? mapFont(s[1], FONT.it!) : s[1]
      return { kind: s[0], box: txt(glyph), ...(LIMITS.has(n) ? { limits: true } : {}) }
    }
    const space = SPACES[n]
    if (space !== undefined) return sp(space)
    const f = FUNCS[n]
    if (f) return { kind: 'op', box: txt(f[0]), limits: f[1] }
    const font = FONT_CMDS[n]
    if (font) return this.fontArg(font)
    const textFont = TEXT_CMDS[n]
    if (textFont) return { kind: 'ord', box: txt(mapFont(textify(this.rawArg()), FONT[textFont] ?? {})) }
    const accent = ACCENTS[n]
    if (accent) {
      const a = this.arg()
      if (!isFlat(a.box)) return a
      const out = cellsOf(flat(a.box))
        .map(c => (c === ' ' ? c : c + accent))
        .join('')
      return { kind: a.kind === 'op' ? 'op' : 'ord', box: txt(out) }
    }
    const arrow = ARROWS[n]
    if (arrow) {
      const below = this.optRaw()
      const above = this.script(() => flat(this.arg().box))
      const lowText = below === null ? '' : this.subText(below)
      const [shaft, head, left] = arrow
      if (this.display) {
        const w = Math.max(sw(above), sw(lowText)) + 2
        const line = left ? head + shaft.repeat(w - 1) : shaft.repeat(w - 1) + head
        const parts = [txt(above), txt(line)]
        if (lowText) parts.push(txt(lowText))
        return { kind: 'rel', box: vstack(parts, 1) }
      }
      return { kind: 'rel', box: txt(left ? head + above + shaft : shaft + above + head) }
    }

    switch (n) {
      case '\\':
        return { kind: 'punct', box: txt(',') }
      case 'frac':
      case 'dfrac':
      case 'cfrac':
      case 'tfrac': {
        const disp = this.display && n !== 'tfrac'
        return this.mode(disp, this.tight, () => {
          const a = this.arg().box
          const b = this.arg().box
          return { kind: 'ord' as const, box: this.frac(a, b, disp) }
        })
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const disp = this.display && n !== 'tbinom'
        return this.mode(disp, this.tight, () => {
          const a = this.arg().box
          const b = this.arg().box
          return { kind: 'ord' as const, box: this.binom(a, b, disp) }
        })
      }
      case 'sqrt': {
        const idxRaw = this.optRaw()
        const r = this.arg().box
        const idx = idxRaw === null ? '' : this.subText(idxRaw)
        const sym = idx === '' ? '√' : idx === '3' ? '∛' : idx === '4' ? '∜' : (toScript(idx, SUP) ?? idx) + '√'
        if (isFlat(r) && isAtomic(flat(r))) return { kind: 'ord', box: txt(sym + flat(r)) }
        if (this.display) return { kind: 'ord', box: sqrt2d(r, idx === '' ? '' : (toScript(idx, SUP) ?? idx)) }
        return { kind: 'ord', box: txt(sym + '(' + flat(r) + ')') }
      }
      case 'left': {
        const l = this.delim()
        const content = this.seq(['\\right'])
        let r = ''
        const t = this.peek()
        if (t?.t === 'cmd' && t.v === 'right') {
          this.i++
          r = this.delim()
        }
        return { kind: 'inner', box: this.display ? delimited(content, l, r) : txt(l + flat(content) + r) }
      }
      case 'right':
        this.delim()
        return null
      case 'middle':
        return { kind: 'ord', box: txt(this.delim()) }
      case 'big':
      case 'Big':
      case 'bigg':
      case 'Bigg':
      case 'bigl':
      case 'Bigl':
      case 'biggl':
      case 'Biggl':
      case 'bigr':
      case 'Bigr':
      case 'biggr':
      case 'Biggr':
      case 'bigm':
      case 'Bigm':
      case 'biggm':
      case 'Biggm':
        return this.atom()
      case 'operatorname':
      case 'operatornamewithlimits': {
        let limits = n === 'operatornamewithlimits'
        if (this.isCh('*')) {
          this.i++
          limits = true
        }
        return { kind: 'op', box: txt(textify(this.rawArg())), limits }
      }
      case 'mathop':
        return { kind: 'op', box: this.arg().box, limits: true }
      case 'mathbin':
        return { kind: 'bin', box: this.arg().box }
      case 'mathrel':
        return { kind: 'rel', box: this.arg().box }
      case 'mathord':
        return { kind: 'ord', box: this.arg().box }
      case 'mathopen':
        return { kind: 'open', box: this.arg().box }
      case 'mathclose':
        return { kind: 'close', box: this.arg().box }
      case 'mathpunct':
        return { kind: 'punct', box: this.arg().box }
      case 'mathinner':
        return { kind: 'inner', box: this.arg().box }
      case 'not': {
        const a = this.atom()
        if (!a) return { kind: 'rel', box: txt('/') }
        const s = flat(a.box)
        return { kind: a.kind, box: txt(NEG[s] ?? s + '̸') }
      }
      case 'overset':
      case 'stackrel':
      case 'underset': {
        const label = this.script(() => flat(this.arg().box))
        const b = this.arg()
        const over = n !== 'underset'
        if (this.display) return { kind: b.kind, box: over ? vstack([txt(label), b.box], 1) : vstack([b.box, txt(label)], 0) }
        const u = toScript(label, over ? SUP : SUB)
        return { kind: b.kind, box: hcat([b.box, txt(u ?? (over ? '^' : '_') + wrap(label))]) }
      }
      case 'overbrace':
      case 'underbrace': {
        const a = this.arg().box
        if (!this.display) return { kind: 'ord', box: a, limits: true }
        const under = n === 'underbrace'
        const row = txt(braceRow(bw(a), under))
        return { kind: 'ord', box: under ? vstack([a, row], 0) : vstack([row, a], 1), limits: true }
      }
      case 'boxed':
      case 'fbox':
      case 'framebox': {
        const a = n === 'boxed' ? this.arg().box : txt(textify(this.rawArg()))
        return { kind: 'ord', box: this.display ? frame(a) : txt('[' + flat(a) + ']') }
      }
      case 'color':
        this.rawArg()
        return null
      case 'textcolor':
      case 'colorbox':
        this.rawArg()
        return this.arg()
      case 'fcolorbox':
        this.rawArg()
        this.rawArg()
        return this.arg()
      case 'phantom':
      case 'hphantom':
        return { kind: 'ord', box: txt(' '.repeat(bw(this.arg().box))) }
      case 'vphantom':
        this.arg()
        return null
      case 'hspace':
      case 'vspace':
      case 'kern':
      case 'mkern':
      case 'mspace':
        if (this.isCh('*')) this.i++
        this.rawArg()
        return n === 'vspace' ? null : sp(' ')
      case 'label':
        this.rawArg()
        return null
      case 'eqref':
        return { kind: 'ord', box: txt('(' + textify(this.rawArg()) + ')') }
      case 'ref':
        return { kind: 'ord', box: txt(textify(this.rawArg())) }
      case 'tag':
        if (this.isCh('*')) this.i++
        return sp('  (' + textify(this.rawArg()) + ')')
      case 'cline':
        this.rawArg()
        return null
      case 'pmod':
        return sp(' (mod ' + flat(this.arg().box) + ')')
      case 'pod':
        return sp(' (' + flat(this.arg().box) + ')')
      case 'begin':
        return this.env()
      case 'end':
        this.rawArg()
        return null
      case 'substack':
      case 'ensuremath':
      case 'mathclap':
      case 'mathllap':
      case 'mathrlap':
      case 'clap':
      case 'llap':
      case 'rlap':
      case 'smash':
      case 'displaylines':
        this.optRaw()
        return this.arg()
      case 'newcommand':
      case 'renewcommand':
      case 'DeclareMathOperator':
      case 'def':
        this.rawArg()
        this.optRaw()
        this.rawArg()
        return null
      case 'over':
      case 'choose':
      case 'atop':
        return null
    }
    if (NULL_CMDS.has(n)) return null
    return { kind: 'ord', box: txt('\\' + n) }
  }

  private subText(src: string): string {
    return flat(new Parser(lex(src), false).top()).replace(/\s+/g, '')
  }

  private env(): Atom {
    const name = this.rawArg().trim()
    const n = name.replace(/\*$/, '')
    let spec = ''
    if (n === 'array' || n === 'subarray' || n === 'alignat' || n === 'alignedat') {
      this.optRaw()
      spec = this.rawArg()
    } else if (n === 'aligned' || n === 'gathered' || n === 'cases' || /matrix$/.test(n)) {
      this.optRaw()
    }
    const aligned = ALIGNED.has(n)
    const rows = this.mode(this.display, false, () => this.body(name, aligned))
    const delims = MATRIX[n]

    if (!this.display) {
      if (aligned || !delims) return { kind: 'inner', box: txt(rows.map(r => r.map(flat).join('')).join('; ')) }
      const inner = rows.map(r => r.map(flat).join(', ')).join('; ')
      const [l, r] = delims[0] === '' && delims[1] === '' ? ['[', ']'] : n.endsWith('cases') ? ['{', '}'] : delims
      return { kind: 'inner', box: txt(l + inner + r) }
    }

    if (aligned) return { kind: 'inner', box: this.alignGrid(rows) }
    if (!delims) return { kind: 'inner', box: grid(rows, () => 'c', () => '  ') }
    const cols = [...spec.replace(/[^lcr]/g, '')] as Align[]
    const isCases = n.endsWith('cases')
    const g = grid(
      rows,
      c => (isCases ? 'l' : (cols[c] ?? 'c')),
      () => '  ',
    )
    return { kind: 'inner', box: delimited(g, delims[0], delims[1]) }
  }
}

function texToLines(src: string, display: boolean, italic = false): string[] {
  const first = new Parser(lex(src), display, italic)
  let box = first.top()
  if (first.subFailed || first.supFailed) {
    const again = new Parser(lex(src), display, italic)
    again.forceLinearSub = first.subFailed
    again.forceLinearSup = first.supFailed
    box = again.top()
  }
  return box.lines.map(l => l.replace(/[  ]+$/, ''))
}

// ---------------------------------------------------------------- markdown

const NBSP4 = '    '
const esc = (s: string): string => s.replace(/[\\`*_[\]<>|~#$]/g, '\\$&')

function convert(body: string, display: boolean): string[] | null {
  if (!body.trim() || body.length > 20000) return null
  try {
    let lines = texToLines(body, display, italicMode && !display)
    if (!display || lines.length === 1) lines = [lines.map(l => l.trim()).join(' ')]
    while (lines.length > 1 && !lines[0]!.trim()) lines.shift()
    while (lines.length > 1 && !lines[lines.length - 1]!.trim()) lines.pop()
    const pad = Math.min(...lines.filter(l => l.trim()).map(l => /^ */.exec(l)![0].length))
    if (Number.isFinite(pad) && pad > 0) lines = lines.map(l => l.slice(pad))
    if (!lines.join('').trim()) return null
    return lines
  } catch {
    return null
  }
}

const DISPLAY_ENV = /^\\begin\{(equation|align|gather|multline|eqnarray|displaymath|flalign|alignat)(\*?)\}/

function nextDollar(s: string, from: number): number {
  for (let k = from; k < s.length; k++) {
    if (s[k] === '\\') {
      k++
      continue
    }
    if (s[k] === '$') return k
  }
  return -1
}

function math(s: string): string {
  if (!s.includes('$') && !s.includes('\\')) return bare(s)
  let out = ''
  let last = 0
  let i = 0

  const emit = (start: number, end: number, body: string, display: boolean): boolean => {
    const lines = convert(body, display)
    if (!lines) return false
    out += bare(s.slice(last, start))
    if (display) out = placeDisplay(out, s, start, end, last, lines, body)
    else if (inlineFound) {
      const text = lines[0]!
      out += mark(inlineFound.push({ tex: body, text, md: esc(text), clean: inlineClean(body) }) - 1)
    }
    else out += esc(lines[0]!)
    last = end
    return true
  }

  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      const n = s[i + 1]
      if (n === '[' || n === '(') {
        const j = s.indexOf(n === '[' ? '\\]' : '\\)', i + 2)
        if (j !== -1 && !(n === '(' && s.slice(i + 2, j).includes('\n\n')) && emit(i, j + 2, s.slice(i + 2, j), n === '[')) {
          i = last
          continue
        }
        i += 2
        continue
      }
      if (n === 'b') {
        const m = DISPLAY_ENV.exec(s.slice(i, i + 40))
        if (m) {
          const endTag = `\\end{${m[1]}${m[2]}}`
          const j = s.indexOf(endTag, i)
          if (j !== -1) {
            const body = m[1] === 'equation' || m[1] === 'displaymath' ? s.slice(i + m[0].length, j) : s.slice(i, j + endTag.length)
            if (emit(i, j + endTag.length, body, true)) {
              i = last
              continue
            }
          }
        }
      }
      i += 2
      continue
    }
    if (c === '$') {
      if (s[i + 1] === '$') {
        const j = s.indexOf('$$', i + 2)
        if (j > i + 2 && emit(i, j + 2, s.slice(i + 2, j), true)) {
          i = last
          continue
        }
        i += 2
        continue
      }
      const j = nextDollar(s, i + 1)
      if (
        j > i + 1 &&
        s[j + 1] !== '$' &&
        !/\s/.test(s[i + 1]!) &&
        !/\s/.test(s[j - 1]!) &&
        !/\d/.test(s[j + 1] ?? '') &&
        !s.slice(i + 1, j).includes('\n\n') &&
        emit(i, j + 1, s.slice(i + 1, j), false)
      ) {
        i = last
        continue
      }
      i++
      continue
    }
    i++
  }
  return out + bare(s.slice(last))
}

// Superscripts and subscripts written in prose with no $…$ around them, as in
// "s^{1/4}", "n^2", "x_i", "O_{r}(1)". An unbraced subscript needs a one-letter
// base and one character, so snake_case names and file_names stay as written.
const BARE =
  /((?<![\\\w$^/.@-])(?:[A-Za-z]+|\d+)|\))((?:\^(?:\{[^{}\n]{1,60}\}|\([^()\n]{1,40}\)|\d+|[A-Za-z])|_(?:\{[^{}\n]{1,60}\}|[A-Za-z0-9]))+)(?![\w{^_])/g
const BARE_PART = /([\^_])(\{[^{}\n]*\}|[A-Za-z0-9]+)/g

function bare(s: string): string {
  if (!s.includes('^') && !s.includes('_')) return s
  return s.replace(BARE, (m: string, base: string, scripts: string) => {
    for (const [, mark, body] of scripts.matchAll(BARE_PART)) {
      if (mark === '_' && !body!.startsWith('{') && base.length > 1 && base !== ')') return m
    }
    // s^(1/4) is ASCII math for s^{1/4}. A parenthesised power with no digit,
    // as in f^(n), is often a derivative, so it stays as written, as does one
    // with no superscript form.
    const tex = m.replace(/\^\(([^()\n]*)\)/g, '^{$1}')
    if (tex !== m && /\^\(/.test(m) && [...m.matchAll(/\^\(([^()\n]*)\)/g)].some(p => !/\d/.test(p[1]!) || toScript(p[1]!.replace(/-/g, '−'), SUP) === null)) return m
    try {
      const out = texToLines(tex, false, italicMode && /^[A-Za-z]$/.test(base)).join(' ').trim()
      return out && out !== m ? esc(out) : m
    } catch {
      return m
    }
  })
}

// Sets display math in a block of its own, keeping the list item or quote it is in.
function placeDisplay(
  out: string,
  s: string,
  start: number,
  end: number,
  last: number,
  lines: string[],
  tex: string,
): string {
  const ls = s.lastIndexOf('\n', start - 1) + 1
  const le = s.indexOf('\n', end)
  const lineText = s.slice(ls, le === -1 ? s.length : le)
  const before = s.slice(ls, start)
  const rest = s.slice(end, le === -1 ? s.length : le)
  const pm = /^([ \t]*(?:>[ \t]?)*)([ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)/.exec(lineText)!
  const quote = pm[1]!
  const marker = pm[2]!
  const indent = quote + ' '.repeat(marker.length)
  const blank = quote.trimEnd()
  const atStart = ls >= last && before.length <= pm[0].length
  const atEnd = rest.trim() === ''

  let o = out
  if (atStart) {
    if (!marker.trim()) o = o.slice(0, o.length - before.length) + blank + '\n' + before
  } else {
    o += '\n' + blank + '\n' + indent
  }
  if (collected) o += '\uE100' + (collected.push({ tex, fallback: lines }) - 1) + '\uE101'
  else if (lines.length === 1) o += NBSP4 + esc(lines[0]!)
  else o += '```\n' + lines.map(l => indent + l).join('\n') + '\n' + indent + '```'
  return o + '\n' + blank + (atEnd ? '' : '\n' + indent)
}

function prose(s: string): string {
  let out = ''
  let i = 0
  let last = 0
  while (i < s.length) {
    if (s[i] === '`') {
      let n = 0
      while (s[i + n] === '`') n++
      const run = '`'.repeat(n)
      let j = i + n
      let close = -1
      while ((j = s.indexOf(run, j)) !== -1) {
        let m = 0
        while (s[j + m] === '`') m++
        if (m === n) {
          close = j
          break
        }
        j += m
      }
      if (close >= 0) {
        out += math(s.slice(last, i)) + s.slice(i, close + n)
        i = last = close + n
        continue
      }
      i += n
      continue
    }
    i++
  }
  return out + math(s.slice(last))
}

function transform(md: string): string {
  const out: string[] = []
  let buf: string[] = []
  let fence: { ch: string; n: number } | null = null
  const flush = (): void => {
    if (buf.length) out.push(prose(buf.join('\n')))
    buf = []
  }
  for (const line of md.split('\n')) {
    if (fence) {
      out.push(line)
      const m = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(line)
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.n) fence = null
      continue
    }
    const m = /^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(`{3,}|~{3,})/.exec(line)
    if (m && !(m[1]![0] === '`' && line.slice(m.index + m[0].length).includes('`'))) {
      flush()
      out.push(line)
      fence = { ch: m[1]![0]!, n: m[1]!.length }
      continue
    }
    buf.push(line)
  }
  flush()
  return out.join('\n')
}

/** A run of markdown, or one display formula: its TeX and its Unicode lines. */
export type Part = { md: string } | { tex: string; fallback: string[] } | { rich: RichBlock } | { table: TableBlock }

let collected: { tex: string; fallback: string[] }[] | null = null
// Inline formulas plain text can't draw cleanly, left for the mod to typeset.
let inlineFound: InlineMath[] | null = null

/** Whether an inline formula's Unicode has every script in Unicode and no unknown command. */
function inlineClean(tex: string): boolean {
  try {
    const p = new Parser(lex(tex), false)
    const out = flat(p.top())
    return !p.subFailed && !p.supFailed && !out.includes('\\')
  } catch {
    return false
  }
}
// Whether inline math sets its variables in math italic: on surfaces with a
// proportional font, not on the terminal, where those letters can misalign.
let italicMode = false
const splitCache = new Map<string, Part[]>()

/**
 * The markdown cut at each display formula, inline math already Unicode: for
 * a surface that draws a formula as an image between blocks of markdown.
 */
export function splitMath(md: string): Part[] {
  if (!/[$\\^_]/.test(md)) return [{ md }]
  italicMode = true
  const hit = splitCache.get(md)
  if (hit) return hit
  const found: { tex: string; fallback: string[] }[] = []
  const inlines: InlineMath[] = []
  collected = found
  inlineFound = inlines
  let out: string
  try {
    out = transform(md)
  } finally {
    collected = null
    inlineFound = null
    italicMode = false
  }
  const parts: Part[] = []
  const pieces = out.split(/\uE100(\d+)\uE101/)
  pieces.forEach((piece, k) => {
    if (k % 2 === 1) {
      const f = found[Number(piece)]
      if (f) parts.push(f)
      return
    }
    const text = piece.replace(/^(?:[ \t>]*\n)+/, '').replace(/(?:\n[ \t>]*)+$/, '')
    if (text.replace(/[\s>]/g, '') !== '') parts.push(...segment(text, inlines))
  })
  if (splitCache.size > 300) splitCache.clear()
  splitCache.set(md, parts)
  return parts
}

const cache = new Map<string, string>()

/**
 * The markdown with every LaTeX math span in its prose drawn as Unicode;
 * `italic` sets inline variables in math italic.
 */
export function renderMath(md: string, opts: { italic?: boolean } = {}): string {
  if (!/[$\\^_]/.test(md)) return md
  const italic = opts.italic === true
  const key = (italic ? 'i' : 'u') + md
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  italicMode = italic
  let out: string
  try {
    out = transform(md)
  } finally {
    italicMode = false
  }
  if (cache.size > 300) cache.clear()
  cache.set(key, out)
  return out
}

/** One formula as Unicode lines: one line inline, possibly several in display. */
export function texToText(src: string, display: boolean): string[] {
  return texToLines(src, display)
}
