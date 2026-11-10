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
    // Math italic on surfaces with a proportional font; upright on the terminal.
    expect(row?.text).toBe(surface === 'terminal' ? 'So x² + y² = z² and α ≤ βᵢ.' : 'So 𝑥² + 𝑦² = 𝑧² and 𝛼 ≤ 𝛽ᵢ.')
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
    expect(after?.text).toBe('for 𝑎 ≠ 0.')
    await ui.unmount()
  }
})

test('the copy button beside an equation copies its LaTeX', async ($, on) => {
  const copied: string[] = []
  // Stands for the engine's clipboard.
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })

  const ui = await $.ui.mount({ ...reply('So\n$$E = mc^2$$\ndone.'), surface: 'desktop' })
  await ui.press({ key: 'copy-1' })
  expect(copied).toEqual(['$$E = mc^2$$'])
  await ui.unmount()
})

test('a paragraph whose inline math Unicode cannot draw is laid out with typeset formulas', async ($, on) => {
  on('ui.render', () => {
    throw new Error('the engine is not reached')
  })

  const ui = await $.ui.mount({
    ...reply('Clean $x_i$ stays text.\n\n- **Energy.** Fix $t$; the support of $\\sum [F_a + F_b]$ over pairs.'),
    surface: 'desktop',
  })
  // The first paragraph is markdown with Unicode math.
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('Clean 𝑥ᵢ stays text.')
  // The list item is laid out: every formula in it typeset, words as text.
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map(x => x.props.alt)).toEqual(['t', '\\sum [F_a + F_b]'])
  expect(svgs[1]?.props.source).toContain('<svg')
  expect((await ui.find({ type: 'Text', text: /^Energy\./ }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^pairs\.$/ })).toBeDefined()
  await ui.unmount()
})

test('a long display equation is broken into lines that fit', async ($, on) => {
  on('ui.render', () => {
    throw new Error('the engine is not reached')
  })

  const sum = Array.from({ length: 24 }, (_, i) => `a_{${i + 1}}`).join(' + ')
  const ui = await $.ui.mount({ ...reply('$$S = ' + sum + '$$'), surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('S = ' + sum)
  expect(svg?.props.width).toBeLessThanOrEqual(680)
  // Shrinking it to fit would leave it under a third of the usual height.
  expect(svg?.props.height).toBeGreaterThan(40)
  await ui.unmount()
})

test('an inline formula is centred on the middle of the text line', async ($, on) => {
  on('ui.render', () => {
    throw new Error('the engine is not reached')
  })

  const ui = await $.ui.mount({ ...reply('Deep $x_{ij}$ and $F_b$ here.'), surface: 'desktop' })
  for (const svg of await ui.findAll({ type: 'Svg' })) {
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(String(svg.props.source))!
    const [minY, h] = [Number(vb[2]), Number(vb[4])]
    expect(Math.round(minY + h / 2)).toBe(-300)
  }
  await ui.unmount()
})

test('the TeX button shows an equation\'s LaTeX below it, and hides it again', async ($, on) => {
  const ui = await $.ui.mount({ ...reply('So\n$$E = mc^2$$\ndone.'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'E = mc^2' })).toBeUndefined()

  await ui.press({ key: 'tex-1' })
  expect((await ui.find({ type: 'Text', text: 'E = mc^2' }))?.props.mono).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'tex-1' }))?.props.label).toBe('Hide TeX')

  await ui.press({ key: 'tex-1' })
  expect(await ui.find({ type: 'Text', text: 'E = mc^2' })).toBeUndefined()
  await ui.unmount()
})

test('a table whose math Unicode can draw stays a markdown table', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })

  const table = '| bound | before | after |\n|---|---|---|\n| exponent $7/16$ | $s^{0.49}$ | $\\tilde O(s^{7/16})$ |'
  const ui = await $.ui.mount({ ...reply(table), surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    '| bound | before | after |\n|---|---|---|\n| exponent 7/16 | 𝑠⁰·⁴⁹ | 𝑂̃(𝑠⁷ᐟ¹⁶) |',
  )
  await ui.unmount()
})

test('a table with math Unicode cannot draw is drawn with typeset cells', async ($, on) => {
  on('ui.render', () => {
    throw new Error('the engine is not reached')
  })

  const table = '| term | value |\n|:---|---:|\n| residual $R_b$ | $\\sum_i F_b$ |\n| clean | $x^2$ |'
  const ui = await $.ui.mount({ ...reply(table), surface: 'desktop' })
  // Every formula in the table is typeset, the clean one too.
  expect((await ui.findAll({ type: 'Svg' })).map(x => x.props.alt)).toEqual(['R_b', '\\sum_i F_b', 'x^2'])
  expect((await ui.find({ type: 'Text', text: /^term/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^residual/ }))?.props.bold).toBeFalsy()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
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

test('the conversation context gains a block asking for $…$ math', async ($, on) => {
  // Stands for the engine's own context blocks.
  on('prompt.context', () => ({ blocks: [{ name: 'currentDate', text: 'today' }] }))

  const { blocks } = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'today' }] })
  expect(blocks.map(b => b.name)).toEqual(['currentDate', 'mathFormatting'])
  expect(blocks[1]?.text).toContain('inside dollar signs')
})

test('a formula writes all its subscripts one way', () => {
  // b has no Unicode subscript, so a is written linearly too.
  expect(texToText('F_a + F_b', false).join('')).toBe('F_a + F_b')
  expect(texToText('F_a + F_i', false).join('')).toBe('Fₐ + Fᵢ')
  expect(renderMath('$\\sum [F_a + F_b]$ and $\\mathbb{F}_2^{10}$', { italic: true })).toBe(
    '∑\\[𝐹\\_a + 𝐹\\_b\\] and 𝔽₂¹⁰',
  )
})

test('code is left alone', () => {
  const md = '```tex\n$\\alpha$\n```\nand `$\\beta$`'
  expect(renderMath(md)).toBe(md)
})
