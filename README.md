# ClaudeTeX

A Claude Code plugin that typesets the LaTeX math in Claude's replies, so research conversations read like a paper rather than raw TeX.

It runs entirely on your machine: no network, no TeX installation. Math is typeset by a bundled copy of [MathJax](https://www.mathjax.org/).

## What it does

**In the Claude desktop app, VS Code and the mobile app**

- **Displayed equations** (`$$…$$`, `\[…\]`, `align`, `cases`, matrices, …) are typeset as images.
  - An equation too wide for the reply is broken across lines, at its relations (`=`, `≤`, `→`) first and then at `+`/`−`, instead of being shrunk.
  - Each equation has a **Copy** button (copies its LaTeX) and a **TeX** button (shows its LaTeX in a box below it; click again to hide).
- **Inline math** (`$…$`, `\(…\)`) becomes Unicode in the sentence, with variables in math italic: `$\alpha \le \beta_i$` → 𝛼 ≤ 𝛽ᵢ, `$\mathbb{F}_2^{10}$` → 𝔽₂¹⁰, `$s^{0.49}$` → 𝑠⁰·⁴⁹.
- **Inline math Unicode can't draw.** Unicode has no subscript b, c, d, …, so `$F_b$` can't be written properly as text. When a paragraph holds such a formula, ClaudeTeX lays the paragraph out itself: words as text, every formula in it typeset, sitting on the text baseline. Bold, italics, strikethrough, inline code, links, list bullets (nested too), headings and quotes are kept.
- **Tables.** A markdown table whose math Unicode can draw stays a normal table. One that needs typesetting is drawn by ClaudeTeX, in Claude Code's own colours, with typeset formulas in its cells and the table's column alignment kept.

**In the terminal**

- Inline math becomes Unicode, as above (letters upright, since math italics can misalign in monospace fonts).
- Displayed equations are laid out in two dimensions with Unicode, in a code block so the columns line up:

  ```
   n       n(n + 1)
   ∑  i = ──────────
  i=1         2
  ```

**Everywhere**

- Claude is told that math renders here and to write it as `$…$` and `$$…$$`, so it reaches the typesetter.
- Bare TeX in prose is converted too: `s^{1/4}` → s¹ᐟ⁴, `O_r(delta^2)` → Oᵣ(delta²), `2^(n-1)` → 2ⁿ⁻¹. `snake_case` names, file names, URLs and `f^(n)` (often a derivative) are left alone.
- Code blocks, inline code and dollar amounts ("$5 or $10") are never touched.
- The saved message is never changed, so ctrl+o still shows the raw LaTeX.
- A formula MathJax can't parse falls back to its Unicode version.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install claudetex --marketplace Hbg1010/ClaudeTeX
```

From a shell:

```bash
claude plugin install claudetex --marketplace Hbg1010/ClaudeTeX
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Hbg1010/ClaudeTeX`, then **Add plugin**.

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Update

New versions don't install themselves. To update:

```bash
claude plugin marketplace update claudetex
```

```bash
claude plugin update claudetex
```

Or use the desktop app's Plugins menu. Sessions started afterwards use the new version; open sessions keep the old one until restarted.

## Limits

- Typeset formulas are images, so selecting text across a paragraph skips them. Use a displayed equation's Copy or TeX button for its LaTeX.
- Equation images follow your system's light or dark setting. The app doesn't tell plugins its own theme, so if the app's theme differs from your system's, equations may be hard to read.
- A long equation that already uses `\\` or an environment (`align`, `cases`) is shrunk to fit rather than re-broken.
- `\label` / `\eqref` cross-references aren't supported.

## Files

- `hooks/register.tsx`: the hooks. It draws assistant messages and adds the instruction about `$…$` math.
- `hooks/latex.ts`: the LaTeX → Unicode typesetter and the markdown scanner.
- `hooks/rich.ts`: splits a reply into markdown and the paragraphs and tables ClaudeTeX draws itself, and reads their inline formatting.
- `hooks/breaks.ts`: breaks long displayed equations into lines.
- `hooks/mathjax/`: MathJax 3.2.2 and mhchemparser, bundled with esbuild into files under the plugin loader's 1 MiB-per-file limit.
- `build/mathjax-entry.js`: the bundle's entry point. To rebuild, install `mathjax-full@3.2.2` and `esbuild`, then bundle it with `--bundle --splitting --format=esm --platform=neutral --minify --define:global=globalThis`, adding extra entry points that each import a third of `mathjax-full/js/output/svg/fonts/tex/*.js` so the font tables land in separate chunks.

Tests: `claude plugin test .`

## Licence

ClaudeTeX is licensed under the Apache License 2.0; see `LICENSE` and `NOTICE`.

It bundles MathJax 3.2.2 and mhchemparser, both also under the Apache License 2.0. Their licences are in `hooks/mathjax/LICENSE-MathJax.txt` and `hooks/mathjax/LICENSE-mhchemparser.txt`.
