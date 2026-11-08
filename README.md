# ClaudeTeX

A Claude Code mod that typesets the LaTeX math in Claude's replies.

- **Display math** (`$$…$$`, `\[…\]`, `\begin{align}…`, matrices, `cases`, …) is typeset by [MathJax](https://www.mathjax.org/) and drawn as an SVG image in the Claude desktop app, VS Code and the mobile app.
- **Inline math** (`$…$`, `\(…\)`) becomes Unicode in the sentence: `$\alpha \le \beta_i$` → α ≤ βᵢ, `$\mathbb{R}^n$` → ℝⁿ, `$\frac{n(n+1)}{2}$` → n(n + 1)/2.
- **On the terminal**, display math is laid out in two dimensions with Unicode, in a code block so its columns line up:

  ```
   n       n(n + 1)
   ∑  i = ──────────
  i=1         2
  ```

Code blocks, inline code and dollar amounts ("$5 or $10") are left alone. The saved message is never changed, so ctrl+o still shows the raw LaTeX. A formula MathJax cannot parse falls back to the Unicode version. Everything runs locally: no network, no TeX installation.

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

## Notes

- Equation images use your system's light or dark setting for their colour. The app doesn't tell plugins its theme, so if the app's theme differs from your system's, equations may be hard to read.
- Equation images can't be copied as text; their alt text is the original TeX.
- Superscripts and subscripts with no Unicode form are written linearly in inline math, e.g. `e^(iπ)`.

## Files

- `hooks/register.tsx`: the `ui.render` hook on assistant messages.
- `hooks/latex.ts`: the LaTeX → Unicode typesetter and the markdown scanner.
- `hooks/mathjax/`: MathJax 3.2.2 (Apache-2.0, see `LICENSE-MathJax.txt`), bundled with esbuild into files under the plugin loader's 1 MiB-per-file limit.
- `build/mathjax-entry.js`: the bundle's entry point. To rebuild, install `mathjax-full@3.2.2` and `esbuild`, then bundle it with `--bundle --splitting --format=esm --platform=neutral --minify --define:global=globalThis`, adding extra entry points that each import a third of `mathjax-full/js/output/svg/fonts/tex/*.js` so the font tables land in separate chunks.

Tests: `claude plugin test .`
