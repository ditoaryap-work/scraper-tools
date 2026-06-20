import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer'

const app = new Hono()

app.use('*', cors())

// --- Color conversion helpers ---
function parseColor(color: string): { hex: string; rgb: string; hsl: string } | null {
  let r = 0, g = 0, b = 0

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    r = parseInt(rgbMatch[1])
    g = parseInt(rgbMatch[2])
    b = parseInt(rgbMatch[3])
  } else {
    return null
  }

  // Skip pure black/white/transparent noise
  if (r === 0 && g === 0 && b === 0) return null
  if (r === 255 && g === 255 && b === 255) return null

  const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')

  // RGB to HSL
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break
      case gn: h = ((bn - rn) / d + 2) / 6; break
      case bn: h = ((rn - gn) / d + 4) / 6; break
    }
  }

  return {
    hex: hex.toUpperCase(),
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
  }
}

function categorizeColor(color: string, context: string): 'text' | 'background' | 'border' | 'accent' {
  if (context.includes('color') && !context.includes('background') && !context.includes('border')) return 'text'
  if (context.includes('background') || context.includes('bg')) return 'background'
  if (context.includes('border')) return 'border'
  return 'accent'
}

// --- Puppeteer extraction (enhanced) ---
async function extractWithPuppeteer(url: string, mode: string) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const page = await browser.newPage()

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    if (mode === 'styleguide' || mode === 'design') {
      const data = await page.evaluate(() => {
        const colors: { value: string; context: string }[] = []
        const fonts = new Map<string, { sizes: Set<string>; weights: Set<string>; contexts: string[] }>()
        const spacing = new Set<string>()

        document.querySelectorAll('*').forEach((el) => {
          const style = window.getComputedStyle(el)

          // Colors
          const props: [string, string][] = [
            ['color', style.color],
            ['backgroundColor', style.backgroundColor],
            ['borderColor', style.borderColor],
            ['outlineColor', style.outlineColor],
          ]
          props.forEach(([prop, val]) => {
            if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
              colors.push({ value: val, context: prop })
            }
          })

          // Fonts
          const family = style.fontFamily?.split(',')[0].replace(/"/g, '').trim()
          if (family && family !== 'normal') {
            if (!fonts.has(family)) {
              fonts.set(family, { sizes: new Set(), weights: new Set(), contexts: [] })
            }
            const entry = fonts.get(family)!
            entry.sizes.add(style.fontSize)
            entry.weights.add(style.fontWeight)
            const tag = el.tagName.toLowerCase()
            if (!entry.contexts.includes(tag)) entry.contexts.push(tag)
          }

          // Spacing (margins/paddings actually used)
          const spacingProps = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom']
          spacingProps.forEach(p => {
            const val = (style as any)[p]
            if (val && val !== '0px' && val !== 'normal') spacing.add(val)
          })
        })

        // Serialize
        const fontsArr: any[] = []
        fonts.forEach((data, family) => {
          fontsArr.push({
            family,
            sizes: Array.from(data.sizes).sort((a, b) => parseFloat(a) - parseFloat(b)),
            weights: Array.from(data.weights).sort(),
            contexts: data.contexts.slice(0, 10)
          })
        })

        return {
          colors,
          fonts: fontsArr,
          spacing: Array.from(spacing).sort((a, b) => parseFloat(a) - parseFloat(b))
        }
      })

      // Process colors
      const colorMap = new Map<string, { hex: string; rgb: string; hsl: string; category: string }>()
      data.colors.forEach(c => {
        const parsed = parseColor(c.value)
        if (parsed && !colorMap.has(parsed.hex)) {
          colorMap.set(parsed.hex, { ...parsed, category: categorizeColor(c.value, c.context) })
        }
      })

      // Sort fonts by usage (most contexts first)
      const sortedFonts = data.fonts.sort((a, b) => b.contexts.length - a.contexts.length)

      // Build structured result
      const structured = {
        url,
        generatedAt: new Date().toISOString(),
        colors: Array.from(colorMap.values()),
        fonts: sortedFonts,
        spacing: data.spacing.slice(0, 20)
      }

      // Generate DESIGN.md
      const designMd = generateDesignMd(structured)

      // Generate CSS custom properties
      const cssTokens = generateCssTokens(structured)

      // Generate Tailwind config
      const tailwindConfig = generateTailwindConfig(structured)

      if (mode === 'design') {
        return {
          type: 'design',
          markdown: designMd,
          cssTokens,
          tailwindConfig,
          data: structured
        }
      }

      // styleguide mode: return structured data
      return {
        type: 'styleguide',
        ...structured,
        markdown: designMd
      }
    }
  } finally {
    await browser.close()
  }
}

function generateDesignMd(data: any): string {
  let md = `# DESIGN.md\n\n`
  md += `> Auto-generated design system documentation for **${data.url}**\n`
  md += `> Generated: ${data.generatedAt}\n\n`
  md += `---\n\n`

  // Color Palette
  md += `## 🎨 Color Palette\n\n`

  const textColors = data.colors.filter((c: any) => c.category === 'text')
  const bgColors = data.colors.filter((c: any) => c.category === 'background')
  const borderColors = data.colors.filter((c: any) => c.category === 'border')
  const accentColors = data.colors.filter((c: any) => c.category === 'accent')

  if (textColors.length) {
    md += `### Text Colors\n\n`
    md += `| Swatch | Hex | RGB | HSL |\n`
    md += `|--------|-----|-----|-----|\n`
    textColors.forEach((c: any) => {
      md += `| ![${c.hex}](https://via.placeholder.com/20/${c.hex.slice(1)}/${c.hex.slice(1)}) | \`${c.hex}\` | \`${c.rgb}\` | \`${c.hsl}\` |\n`
    })
    md += `\n`
  }

  if (bgColors.length) {
    md += `### Background Colors\n\n`
    md += `| Swatch | Hex | RGB | HSL |\n`
    md += `|--------|-----|-----|-----|\n`
    bgColors.forEach((c: any) => {
      md += `| ![${c.hex}](https://via.placeholder.com/20/${c.hex.slice(1)}/${c.hex.slice(1)}) | \`${c.hex}\` | \`${c.rgb}\` | \`${c.hsl}\` |\n`
    })
    md += `\n`
  }

  if (accentColors.length) {
    md += `### Accent Colors\n\n`
    md += `| Swatch | Hex | RGB | HSL |\n`
    md += `|--------|-----|-----|-----|\n`
    accentColors.forEach((c: any) => {
      md += `| ![${c.hex}](https://via.placeholder.com/20/${c.hex.slice(1)}/${c.hex.slice(1)}) | \`${c.hex}\` | \`${c.rgb}\` | \`${c.hsl}\` |\n`
    })
    md += `\n`
  }

  if (borderColors.length) {
    md += `### Border Colors\n\n`
    md += `| Swatch | Hex | RGB | HSL |\n`
    md += `|--------|-----|-----|-----|\n`
    borderColors.forEach((c: any) => {
      md += `| ![${c.hex}](https://via.placeholder.com/20/${c.hex.slice(1)}/${c.hex.slice(1)}) | \`${c.hex}\` | \`${c.rgb}\` | \`${c.hsl}\` |\n`
    })
    md += `\n`
  }

  // Typography
  md += `## 🔤 Typography\n\n`

  if (data.fonts.length) {
    data.fonts.forEach((font: any, i: number) => {
      const role = i === 0 ? 'Primary (Headings & Body)' : i === 1 ? 'Secondary' : `Fallback ${i}`
      md += `### ${font.family}\n`
      md += `> Role: **${role}** | Used in: \`${font.contexts.join('`, `')}\`\n\n`
      md += `- **Weights:** ${font.weights.map((w: string) => `\`${w}\``).join(', ')}\n`
      md += `- **Sizes:** ${font.sizes.map((s: string) => `\`${s}\``).join(', ')}\n\n`
    })
  }

  // Type Scale
  md += `### Type Scale\n\n`
  const allSizes = new Set<string>()
  data.fonts.forEach((f: any) => f.sizes.forEach((s: string) => allSizes.add(s)))
  const sortedSizes = Array.from(allSizes).sort((a, b) => parseFloat(a) - parseFloat(b))

  if (sortedSizes.length) {
    md += `| Token | Size | Rem |\n`
    md += `|-------|------|-----|\n`
    sortedSizes.forEach((size, i) => {
      const px = parseFloat(size)
      const rem = (px / 16).toFixed(3).replace(/\.?0+$/, '')
      const token = `text-${i === 0 ? 'xs' : i === 1 ? 'sm' : i === 2 ? 'base' : i === 3 ? 'lg' : i === 4 ? 'xl' : i === 5 ? '2xl' : `${i + 1}xl`}`
      md += `| \`${token}\` | \`${size}\` | \`${rem}rem\` |\n`
    })
    md += `\n`
  }

  // Spacing
  if (data.spacing?.length) {
    md += `## 📏 Spacing\n\n`
    md += `| Token | Value |\n`
    md += `|-------|-------|\n`
    data.spacing.slice(0, 12).forEach((s: string, i: number) => {
      const px = parseFloat(s)
      const rem = (px / 16).toFixed(3).replace(/\.?0+$/, '')
      md += `| \`space-${i + 1}\` | \`${s}\` (\`${rem}rem\`) |\n`
    })
    md += `\n`
  }

  md += `---\n\n`
  md += `*Generated by [OmniExtract](https://frontend-three-sable-21.vercel.app)*\n`

  return md
}

function generateCssTokens(data: any): string {
  let css = `/* Design Tokens for ${data.url} */\n`
  css += `/* Generated by OmniExtract */\n\n`
  css += `:root {\n`
  css += `  /* Colors */\n`
  data.colors.forEach((c: any, i: number) => {
    const name = `${c.category}-${i + 1}`.replace(/([A-Z])/g, '-$1').toLowerCase()
    css += `  --color-${name}: ${c.hex};\n`
  })
  css += `\n  /* Typography */\n`
  data.fonts.forEach((f: any, i: number) => {
    const name = f.family.toLowerCase().replace(/\s+/g, '-')
    css += `  --font-${i === 0 ? 'primary' : i === 1 ? 'secondary' : `fallback-${i}`}: '${f.family}', sans-serif;\n`
  })
  css += `\n  /* Type Scale */\n`
  const allSizes = new Set<string>()
  data.fonts.forEach((f: any) => f.sizes.forEach((s: string) => allSizes.add(s)))
  const sortedSizes = Array.from(allSizes).sort((a, b) => parseFloat(a) - parseFloat(b))
  sortedSizes.forEach((size, i) => {
    const rem = (parseFloat(size) / 16).toFixed(3).replace(/\.?0+$/, '')
    css += `  --text-${i}: ${rem}rem; /* ${size} */\n`
  })
  css += `}\n`
  return css
}

function generateTailwindConfig(data: any): string {
  let config = `// tailwind.config.js (theme.extend)\n`
  config += `// Generated by OmniExtract\n\n`
  config += `theme: {\n  extend: {\n`

  // Colors
  config += `    colors: {\n`
  const colorGroups: Record<string, string[]> = {}
  data.colors.forEach((c: any) => {
    if (!colorGroups[c.category]) colorGroups[c.category] = []
    colorGroups[c.category].push(c.hex)
  })
  Object.entries(colorGroups).forEach(([group, colors]) => {
    config += `      '${group}': {\n`
    colors.forEach((hex, i) => {
      config += `        '${(i + 1) * 100}': '${hex}',\n`
    })
    config += `      },\n`
  })
  config += `    },\n`

  // Font families
  config += `    fontFamily: {\n`
  data.fonts.forEach((f: any, i: number) => {
    const key = i === 0 ? 'primary' : i === 1 ? 'secondary' : `fallback-${i}`
    config += `      '${key}': ['"${f.family}"', 'sans-serif'],\n`
  })
  config += `    },\n`

  // Font sizes
  config += `    fontSize: {\n`
  const allSizes = new Set<string>()
  data.fonts.forEach((f: any) => f.sizes.forEach((s: string) => allSizes.add(s)))
  const sortedSizes = Array.from(allSizes).sort((a, b) => parseFloat(a) - parseFloat(b))
  sortedSizes.forEach((size, i) => {
    const rem = (parseFloat(size) / 16).toFixed(3).replace(/\.?0+$/, '')
    config += `      '${i}': '${rem}rem', // ${size}\n`
  })
  config += `    },\n`

  config += `  },\n},\n`
  return config
}

// --- Routes ---

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'OmniExtract API', version: '1.1.0' })
})

app.post('/scrape', async (c) => {
  const body = await c.req.json()
  const { url, mode } = body

  if (!url) return c.json({ error: 'URL is required' }, 400)

  try {
    // 1. Markdown, HTML, Crawl via Jina Reader
    if (mode === 'markdown' || mode === 'html' || mode === 'crawl') {
      const headers: Record<string, string> = {
        'Accept': mode === 'html' ? 'text/html' : 'text/plain',
      }
      if (mode === 'html') {
        headers['X-Return-Format'] = 'html'
      }
      if (mode === 'crawl') {
        headers['X-No-Cache'] = 'true'
        headers['X-With-Links-Summary'] = 'true'
        headers['X-With-Images-Summary'] = 'true'
      }

      const response = await fetch(`https://r.jina.ai/${url}`, { headers })
      return c.json({ result: await response.text() })
    }

    // 2. Extract Images — return structured JSON
    if (mode === 'images') {
      const htmlResp = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          'Accept': 'text/html',
          'X-Return-Format': 'html',
          'X-With-Images-Summary': 'true',
        }
      })
      const html = await htmlResp.text()

      if (!html.includes('<')) {
        return c.json({ error: `Failed to fetch HTML: ${html.substring(0, 200)}` }, 502)
      }

      const $ = cheerio.load(html)
      const images: { src: string; alt: string }[] = []
      const seen = new Set<string>()

      const addImage = (src: string | undefined, alt: string = '') => {
        if (!src || src.startsWith('data:') || src.length < 5) return
        try {
          const absoluteUrl = new URL(src, url).href
          if (absoluteUrl.includes('1x1') || absoluteUrl.includes('pixel') || absoluteUrl.includes('spacer')) return
          if (!seen.has(absoluteUrl)) {
            seen.add(absoluteUrl)
            images.push({ src: absoluteUrl, alt: alt || '' })
          }
        } catch (e) {
          if (!seen.has(src)) {
            seen.add(src)
            images.push({ src, alt: alt || '' })
          }
        }
      }

      $('img').each((_, el) => {
        const alt = $(el).attr('alt') || ''
        addImage($(el).attr('src'), alt)
        addImage($(el).attr('data-src'), alt)
        addImage($(el).attr('data-lazy-src'), alt)
        addImage($(el).attr('data-original'), alt)
        addImage($(el).attr('data-hi-res-src'), alt)
        addImage($(el).attr('data-srcset'), alt)
        const srcset = $(el).attr('srcset')
        if (srcset) {
          srcset.split(',').forEach(entry => {
            const srcUrl = entry.trim().split(/\s+/)[0]
            addImage(srcUrl, alt)
          })
        }
      })

      $('picture source').each((_, el) => {
        const srcset = $(el).attr('srcset')
        if (srcset) {
          srcset.split(',').forEach(entry => {
            const srcUrl = entry.trim().split(/\s+/)[0]
            addImage(srcUrl)
          })
        }
      })

      $('[style]').each((_, el) => {
        const style = $(el).attr('style') || ''
        const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/)
        if (bgMatch) addImage(bgMatch[1])
      })

      $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
        addImage($(el).attr('content'))
      })

      return c.json({
        type: 'images',
        images,
        count: images.length
      })
    }

    // 3. Styleguide and Design MD via Puppeteer
    if (mode === 'styleguide' || mode === 'design') {
      const result = await extractWithPuppeteer(url, mode)
      return c.json(result)
    }

    return c.json({ error: 'Invalid mode' }, 400)

  } catch (error: any) {
    console.error(error)
    return c.json({ error: error.message || 'Failed to scrape' }, 500)
  }
})

// Proxy image download — bypasses CORS for frontend
app.get('/proxy-image', async (c) => {
  const imageUrl = c.req.query('url')
  if (!imageUrl) return c.json({ error: 'url parameter required' }, 400)

  try {
    const resp = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    })
    if (!resp.ok) return c.json({ error: `Failed to fetch image: ${resp.status}` }, resp.status as any)

    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    const buffer = await resp.arrayBuffer()

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      }
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to proxy image' }, 500)
  }
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Backend API listening on http://localhost:${info.port}`)
})
