import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors())

app.post('/scrape', async (c) => {
  const body = await c.req.json()
  const { url, mode } = body

  if (!url) {
    return c.json({ error: 'URL is required' }, 400)
  }

  try {
    // 1. Markdown & HTML mode via Jina Reader (Free, Stateless)
    if (mode === 'markdown' || mode === 'html' || mode === 'crawl') {
      const targetUrl = `https://r.jina.ai/${url}`
      
      const headers: Record<string, string> = {
        'Accept': mode === 'html' ? 'text/html' : 'text/plain',
      }
      
      // Jina specific headers
      if (mode === 'html') {
        headers['X-Return-Format'] = 'html'
      }

      const response = await fetch(targetUrl, { headers })
      const resultText = await response.text()
      
      return c.json({ result: resultText })
    }

    // 2. Placeholder for Python IRIS script 
    if (mode === 'styleguide' || mode === 'design') {
      // TODO: Spawn Python process to run IRIS
      return c.json({ 
        result: `[Mock] Styleguide for ${url} will be extracted here. Backend requires Python+Playwright setup.` 
      })
    }

    if (mode === 'images') {
      return c.json({ result: `[Mock] Image scraping for ${url}.` })
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
