import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer'

const app = new Hono()

app.use('*', cors())

// Helper to scrape with Headless Chrome (for complex rendering like styleguides)
async function extractWithPuppeteer(url: string, mode: string) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    if (mode === 'styleguide' || mode === 'design') {
      // Inject script to extract fonts and colors
      const data = await page.evaluate(() => {
        const colors = new Set<string>();
        const fonts = new Set<string>();
        
        // Walk DOM
        document.querySelectorAll('*').forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.color && style.color !== 'rgba(0, 0, 0, 0)') colors.add(style.color);
          if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.add(style.backgroundColor);
          if (style.fontFamily) fonts.add(style.fontFamily.split(',')[0].replace(/"/g, '').trim());
        });

        return {
          colors: Array.from(colors),
          fonts: Array.from(fonts)
        };
      });
      
      let markdown = `# Design System / Styleguide for ${url}\n\n## Fonts\n`;
      data.fonts.forEach(f => markdown += `- ${f}\n`);
      markdown += `\n## Colors\n`;
      data.colors.forEach(c => markdown += `- \`${c}\`\n`);
      
      return mode === 'design' 
        ? `# DESIGN.md\n\nGenerated automatically.\n\n${markdown}`
        : markdown;
    }
  } finally {
    await browser.close();
  }
}

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
      // Crawl mode: deep extraction with extra options
      if (mode === 'crawl') {
        headers['X-No-Cache'] = 'true'
        headers['X-With-Links-Summary'] = 'true'
        headers['X-With-Images-Summary'] = 'true'
      }

      const response = await fetch(`https://r.jina.ai/${url}`, { headers })
      return c.json({ result: await response.text() })
    }

    // 2. Extract Images via Jina Reader HTML + Cheerio
    //    Uses Jina Reader as proxy to bypass 403/bot detection and get rendered HTML
    if (mode === 'images') {
      const htmlResp = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          'Accept': 'text/html',
          'X-Return-Format': 'html',
          'X-With-Images-Summary': 'true',
        }
      })
      const html = await htmlResp.text()
      
      // Check if Jina returned an error (non-HTML response)
      if (!html.includes('<')) {
        return c.json({ error: `Failed to fetch HTML: ${html.substring(0, 200)}` }, 502)
      }
      
      const $ = cheerio.load(html)
      const images: string[] = []
      const seen = new Set<string>()

      // Helper to add unique absolute URLs
      const addImage = (src: string | undefined) => {
        if (!src || src.startsWith('data:') || src.length < 5) return
        try {
          const absoluteUrl = new URL(src, url).href
          // Filter out tracking pixels, icons, and tiny images
          if (absoluteUrl.includes('1x1') || absoluteUrl.includes('pixel') || absoluteUrl.includes('spacer')) return
          if (!seen.has(absoluteUrl)) {
            seen.add(absoluteUrl)
            images.push(absoluteUrl)
          }
        } catch (e) {
          if (!seen.has(src)) {
            seen.add(src)
            images.push(src)
          }
        }
      }

      // Standard <img src>
      $('img').each((_, el) => {
        addImage($(el).attr('src'))
        // Lazy loading attributes
        addImage($(el).attr('data-src'))
        addImage($(el).attr('data-lazy-src'))
        addImage($(el).attr('data-original'))
        addImage($(el).attr('data-hi-res-src'))
        addImage($(el).attr('data-srcset'))
        // srcset: extract all URLs
        const srcset = $(el).attr('srcset')
        if (srcset) {
          srcset.split(',').forEach(entry => {
            const srcUrl = entry.trim().split(/\s+/)[0]
            addImage(srcUrl)
          })
        }
      })

      // <source> inside <picture>
      $('picture source').each((_, el) => {
        const srcset = $(el).attr('srcset')
        if (srcset) {
          srcset.split(',').forEach(entry => {
            const srcUrl = entry.trim().split(/\s+/)[0]
            addImage(srcUrl)
          })
        }
      })
      
      // Background images from inline styles
      $('[style]').each((_, el) => {
        const style = $(el).attr('style') || ''
        const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/)
        if (bgMatch) addImage(bgMatch[1])
      })

      // og:image and meta images
      $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
        addImage($(el).attr('content'))
      })
      
      return c.json({ 
        result: `Found ${images.length} images:\n\n` + images.join('\n')
      })
    }

    // 3. Styleguide and Design MD via Puppeteer (Real browser)
    if (mode === 'styleguide' || mode === 'design') {
      const result = await extractWithPuppeteer(url, mode);
      return c.json({ result });
    }

    return c.json({ error: 'Invalid mode' }, 400)

  } catch (error: any) {
    console.error(error)
    return c.json({ error: error.message || 'Failed to scrape' }, 500)
  }
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Backend API listening on http://localhost:${info.port}`)
})