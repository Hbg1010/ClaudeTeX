import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import 'mathjax-full/js/input/tex/braket/BraketConfiguration.js'
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js'
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js'
import 'mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js'
import 'mathjax-full/js/input/tex/physics/PhysicsConfiguration.js'
import 'mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js'
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js'
import 'mathjax-full/js/input/tex/upgreek/UpgreekConfiguration.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'braket', 'cancel', 'color', 'mathtools', 'textmacros', 'physics', 'unicode', 'mhchem', 'upgreek'] })
const svg = new SVG({ fontCache: 'local' })
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg })

/**
 * TeX to a standalone SVG: its markup, and its size in ex. Throws on a TeX
 * error (an undefined macro, unbalanced braces), so the caller can fall back.
 */
export function texToSvg(src, display) {
  const node = doc.convert(src, { display, em: 16, ex: 8, containerWidth: 80 * 16 })
  const svgNode = adaptor.firstChild(node)
  const html = adaptor.outerHTML(svgNode)
  if (html.includes('data-mml-node="merror"')) throw new Error('TeX error')
  const num = name => parseFloat((new RegExp(name + '="([\\d.]+)ex"').exec(html) || [])[1] || '0')
  return { svg: html, width: num('width'), height: num('height') }
}
