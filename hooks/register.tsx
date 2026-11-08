import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import { breakLines } from './breaks'
import { renderMath, splitMath } from './latex'
import { texToSvg } from './mathjax/mathjax-svg.js'
import type { RichBlock } from './rich'

// Pixels per ex of the math (display, and inline beside body text), and the
// widest a formula is drawn before it is scaled down.
const EX = 8
const INLINE_EX = 7.5
const MAX_WIDTH = 680
const NBSP = '\u00a0'

// SVG drawn as an image paints `currentColor` black; this follows the light or dark scheme.
const STYLE = '<style>svg{color:#1f1f1f}@media (prefers-color-scheme: dark){svg{color:#ececec}}</style>'

// Added to the context the conversation's first message carries (where the
// desktop app's sessions take it too), so Claude marks math where this mod can
// find it.
const NUDGE = `This interface renders LaTeX math in your replies. Write every mathematical expression in LaTeX inside dollar signs: inline math as $...$ (for example $s^{1/4}$ or $O_r(\\delta^2)$) and displayed equations as $$...$$ on lines of their own. Do not write bare TeX such as s^{1/4} or ad hoc forms such as sqrt(delta) in prose. Keep math out of code spans and code blocks unless it is literally code.`

// Where the middle of a line of body text sits above its baseline, in
// thousandths of the math's em (MathJax's viewBox unit). An inline formula is
// padded so this height is its centre: a row centring it beside text then
// puts its baseline on theirs.
const TEXT_MIDDLE = 300

type Typeset = { source: string; width: number; height: number } | null
const typeset = new Map<string, Typeset>()

function measure(tex: string): number | null {
  try {
    return texToSvg(tex, true).width * EX
  } catch {
    return null
  }
}

// Pads an inline formula's viewBox so the text middle is its vertical centre.
function centreOnText(svg: string, heightPx: number): { svg: string; height: number } {
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg)
  if (!vb) return { svg, height: heightPx }
  const [x, minY, w, h] = vb.slice(1).map(Number) as [number, number, number, number]
  const centre = -TEXT_MIDDLE
  const half = Math.max(centre - minY, minY + h - centre, 1)
  const perUnit = heightPx / h
  return {
    svg: svg.replace(vb[0], `viewBox="${x} ${centre - half} ${w} ${2 * half}"`),
    height: 2 * half * perUnit,
  }
}

function svgFor(tex: string, display = true): Typeset {
  const key = (display ? 'D' : 'I') + tex
  const hit = typeset.get(key)
  if (hit !== undefined) return hit
  let out: Typeset = null
  try {
    // A display equation too wide for the reply is broken into lines first.
    const set = (display && breakLines(tex, MAX_WIDTH, measure)) || tex
    const r = texToSvg(set, display)
    const ex = display ? EX : INLINE_EX
    const scale = r.width * ex > MAX_WIDTH ? MAX_WIDTH / (r.width * ex) : 1
    let svg = r.svg
    let height = r.height * ex * scale
    if (!display) ({ svg, height } = centreOnText(svg, height))
    const source = svg.replace(/^<svg([^>]*)>/, (open: string) => open + STYLE)
    if (source.length <= 131072) {
      out = { source, width: Math.round(r.width * ex * scale), height: Math.round(height) }
    }
  } catch {
    out = null
  }
  if (typeset.size > 500) typeset.clear()
  typeset.set(key, out)
  return out
}

type GuiTable = ElementTable<'desktop' | 'vscode' | 'mobile'>

// Display equations whose LaTeX is open below them, by message and part.
const shownTex = atom({ plugin: 'claudetex', key: 'shownTex' } as const, [] as string[])

// A paragraph, list item or heading whose inline math plain text can't draw:
// a wrapping row of words, each formula a small typeset image beside them.
function richParagraph(b: RichBlock, k: number, t: GuiTable) {
  const { Box, Link, Svg, Text } = t
  const items = b.runs.map((r, j) => {
    const gap = r.spaceAfter ? NBSP : ''
    if (r.kind === 'math') {
      const m = svgFor(r.tex, false)
      if (!m) return <Text>{r.text + gap}</Text>
      const img = <Svg source={m.source} alt={r.tex} width={m.width} height={m.height} />
      return gap ? (
        <Box flexDirection="row" alignItems="center">
          {img}
          <Text>{gap}</Text>
        </Box>
      ) : (
        img
      )
    }
    if (r.href) {
      return (
        <Box flexDirection="row">
          <Link href={r.href} label={r.text} />
          <Text>{gap}</Text>
        </Box>
      )
    }
    return (
      <Text bold={r.bold || b.heading} italic={r.italic} mono={r.code}>
        {r.text + gap}
      </Text>
    )
  })
  const body = (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" flexShrink={1}>
      {items}
    </Box>
  )
  if (!b.marker) return <Box key={`p-${k}`} marginY="sm">{body}</Box>
  return (
    <Box key={`p-${k}`} flexDirection="row" marginY="xs">
      <Text>{b.marker + NBSP + NBSP}</Text>
      {body}
    </Box>
  )
}

// Rewrites each assistant reply block before the surface draws it. On the
// desktop app, VS Code and mobile, display math ($$…$$, \[…\], align, …) is
// typeset by MathJax and drawn as an image between blocks of markdown; inline
// math, and everything on the terminal, becomes Unicode. The stored message is
// untouched, so ctrl+o still shows the raw LaTeX.
export const register: Register = on => {
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    if (r.blocks.some(b => b.name === 'mathFormatting')) return r
    return { ...r, blocks: [...r.blocks, { name: 'mathFormatting', text: NUDGE }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Math italic needs a proportional font; the terminal keeps letters upright.
    const unicode = () => {
      const text = renderMath(e.props.text, { italic: e.surface !== 'terminal' })
      return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
    }

    if (e.surface === 'terminal' || e.props.isSummary) {
      return unicode()
    }

    const parts = splitMath(e.props.text)
    if (!parts.some(p => 'tex' in p || 'rich' in p)) {
      return unicode()
    }

    const table = $.ui.resolve(e)
    const { Box, Button, Markdown, Svg, Text } = table
    const open = await read($, shownTex)

    return (
      <Box flexDirection="column">
        {parts.map((p, k) => {
          if ('md' in p) {
            return <Markdown text={p.md} />
          }
          if ('rich' in p) {
            return richParagraph(p.rich, k, table)
          }
          const math = svgFor(p.tex)
          if (!math) {
            const fence = p.fallback.length > 1
            return <Markdown text={fence ? '```\n' + p.fallback.join('\n') + '\n```' : p.fallback[0]!} />
          }
          // An image can't be selected as text, so each equation carries a
          // button that copies its LaTeX and one that shows it below, in the
          // reply's flow where it covers nothing, in Claude Code's own colours.
          const tex = '$$' + p.tex.trim() + '$$'
          const id = e.requestId + ':' + k
          const isOpen = open.includes(id)
          return (
            <Box key={`eq-${k}`} marginY={1} flexDirection="column" alignItems="center">
              <Box flexDirection="row" justifyContent="center" alignItems="center">
                <Svg source={math.source} alt={p.tex} width={math.width} height={math.height} />
                <Box marginLeft={2} flexDirection="row">
                  <Button
                    key={`copy-${k}`}
                    label="Copy"
                    plain
                    dimColor
                    onPress={press => void $.ui.copy({ text: tex, surface: press.surface })}
                  />
                  <Box marginLeft={1}>
                    <Button
                      key={`tex-${k}`}
                      label={isOpen ? 'Hide TeX' : 'TeX'}
                      plain
                      dimColor
                      onPress={() =>
                        void update($, shownTex, list =>
                          list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-200),
                        )
                      }
                    />
                  </Box>
                </Box>
              </Box>
              {isOpen && (
                <Box marginTop={1} borderStyle="round" borderColor="promptBorder" paddingX={1}>
                  <Text mono size="caption">
                    {p.tex.trim()}
                  </Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
