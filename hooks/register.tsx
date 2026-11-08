import type { Register } from 'claude-code'

import { renderMath, splitMath } from './latex'
import { texToSvg } from './mathjax/mathjax-svg.js'

// Pixels per ex of the math, and the widest a formula is drawn before it is scaled down.
const EX = 8
const MAX_WIDTH = 680

// SVG drawn as an image paints `currentColor` black; this follows the light or dark scheme.
const STYLE = '<style>svg{color:#1f1f1f}@media (prefers-color-scheme: dark){svg{color:#ececec}}</style>'

// Added to the context the conversation's first message carries (where the
// desktop app's sessions take it too), so Claude marks math where this mod can
// find it.
const NUDGE = `This interface renders LaTeX math in your replies. Write every mathematical expression in LaTeX inside dollar signs: inline math as $...$ (for example $s^{1/4}$ or $O_r(\\delta^2)$) and displayed equations as $$...$$ on lines of their own. Do not write bare TeX such as s^{1/4} or ad hoc forms such as sqrt(delta) in prose. Keep math out of code spans and code blocks unless it is literally code.`

type Typeset = { source: string; width: number; height: number } | null
const typeset = new Map<string, Typeset>()

function svgFor(tex: string): Typeset {
  const hit = typeset.get(tex)
  if (hit !== undefined) return hit
  let out: Typeset = null
  try {
    const r = texToSvg(tex, true)
    const scale = r.width * EX > MAX_WIDTH ? MAX_WIDTH / (r.width * EX) : 1
    const source = r.svg.replace(/^<svg([^>]*)>/, (open: string) => open + STYLE)
    if (source.length <= 131072) {
      out = { source, width: Math.round(r.width * EX * scale), height: Math.round(r.height * EX * scale) }
    }
  } catch {
    out = null
  }
  if (typeset.size > 500) typeset.clear()
  typeset.set(tex, out)
  return out
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

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const unicode = () => {
      const text = renderMath(e.props.text)
      return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
    }

    if (e.surface === 'terminal' || e.props.isSummary) {
      return unicode()
    }

    const parts = splitMath(e.props.text)
    if (!parts.some(p => 'tex' in p)) {
      return unicode()
    }

    const { Box, Markdown, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {parts.map(p => {
          if ('md' in p) {
            return <Markdown text={p.md} />
          }
          const math = svgFor(p.tex)
          if (!math) {
            const fence = p.fallback.length > 1
            return <Markdown text={fence ? '```\n' + p.fallback.join('\n') + '\n```' : p.fallback[0]!} />
          }
          return (
            <Box marginY={1} alignItems="center">
              <Svg source={math.source} alt={p.tex} width={math.width} height={math.height} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
