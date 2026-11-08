/** Display equations whose LaTeX is shown below them: `<message id>:<part index>`. */
export type ShownTex = string[]

declare module 'claude-code' {
  interface PluginState {
    claudetex: { shownTex: ShownTex }
  }
}
