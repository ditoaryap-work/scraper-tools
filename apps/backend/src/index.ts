import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('OmniScrape Backend Running!'))

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
