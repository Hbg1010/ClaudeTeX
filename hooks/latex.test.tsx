import { expect, test } from 'claude-code/testing'

import { renderMath, texToText } from './latex'

const reply = (text: string) =>
  ({
    plugin: 'claudetex',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  }) as const

test('inline math becomes Unicode in the drawn reply, on every surface', async ($, on) => {
  // Stands for the engine: draws whatever text the mod hands down.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply('So $x^2 + y^2 = z^2$ and $\\alpha \\leq \\beta_i$.'), surface })
    const row = await ui.find({ type: 'Text' })
    expect(row?.text).toBe('So x² + y² = z² and α ≤ βᵢ.')
    await ui.unmount()
  }
})

test('a reply with no math reaches the engine unchanged', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })

  const text = 'It costs $5 or $10, and `echo $HOME` prints a path.'
  const ui = await $.ui.mount({ ...reply(text), surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(text)
  await ui.unmount()
})

test('display math is a typeset SVG on desktop, vscode and mobile', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      ...reply('The roots are\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$\nfor $a \\ne 0$.'),
      surface,
    })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.source).toContain('<svg')
    expect(svg?.props.alt).toBe('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}')
    const after = await ui.find({ type: 'Markdown', text: /for/ })
    expect(after?.text).toBe('for a ≠ 0.')
    await ui.unmount()
  }
})

test('the terminal keeps the Unicode drawing of display math', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })

  const ui = await $.ui.mount({ ...reply('$$E = mc^2$$'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('E = mc²')
  await ui.unmount()
})

test('a formula MathJax rejects falls back to Unicode', async ($, on) => {
  on('ui.render', () => {
    throw new Error('the engine is not reached')
  })

  const ui = await $.ui.mount({ ...reply('$$\\nosuchmacro{x} + 1$$'), surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('\\nosuchmacro')
  await ui.unmount()
})

test('inline formulas', () => {
  const cases: [string, string][] = [
    ['\\frac{n(n+1)}{2}', 'n(n + 1)/2'],
    ['\\sum_{i=1}^{n} i', '∑ᵢ₌₁ⁿ i'],
    ['\\mathbb{R}^n', 'ℝⁿ'],
    ['\\sqrt{x^2+1}', '√(x² + 1)'],
    ['a \\equiv b \\pmod{n}', 'a ≡ b (mod n)'],
    ['|x| \\le 1', '|x| ≤ 1'],
    ['\\sin^2 x + \\cos^2 x = 1', 'sin² x + cos² x = 1'],
    ['\\left( \\frac{a}{b} \\right)^2', '(a/b)²'],
    ['\\int_0^1 f(x)\\,dx', '∫₀¹ f(x) dx'],
  ]
  for (const [tex, want] of cases) expect(texToText(tex, false).join('')).toBe(want)
})

test('display math is typeset in two dimensions inside a fence', () => {
  const out = renderMath('The identity is\n$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$\nby induction.')
  expect(out).toBe(
    'The identity is\n\n```\n n       n(n + 1)\n ∑  i = ──────────\ni=1         2\n```\n\nby induction.',
  )
})

test('bare superscripts and subscripts in prose are converted', () => {
  expect(renderMath('about s^{1/4}, and O_r(delta^2), 2^{10}, x_{ij}, (a+b)^2')).toBe(
    'about s¹ᐟ⁴, and Oᵣ(delta²), 2¹⁰, xᵢⱼ, (a+b)²',
  )
  expect(renderMath('s^(1/4) beats log s, and n^(-1) too')).toBe('s¹ᐟ⁴ beats log s, and n⁻¹ too')
  expect(renderMath('f^(x + y) and f^(n) and 2^(n-1)')).toBe('f^(x + y) and f^(n) and 2ⁿ⁻¹')
  const names = 'snake_case, file_name.py, my_var_2, __init__, https://x.com/v_2/page, [^1]'
  expect(renderMath(names)).toBe(names)
})

test('the system prompt gains a section asking for $…$ math', async ($, on) => {
  // Stands for the engine's own composition.
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core prompt', scope: 'shared' as const }] }))

  const { sections } = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(sections.map(s => s.id)).toEqual(['intro', 'claudetex:math'])
  expect(sections[1]?.text).toContain('inside dollar signs')
})

test('code is left alone', () => {
  const md = '```tex\n$\\alpha$\n```\nand `$\\beta$`'
  expect(renderMath(md)).toBe(md)
})
