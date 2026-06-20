# OmniExtract (Sugi Tools Clone) - Hand-off Document

**Date:** 2026-06-20
**Project Path:** `/Users/ditoaryap/Documents/Project/scraper-tools`
**Live Frontend:** https://frontend-three-sable-21.vercel.app
**Live Backend API:** https://api-scraper.ditoaryap.web.id/scrape (Hosted on VPS `ditoaryap` 43.163.117.57)

## Overview
Successfully built a lightweight, 100% free web scraper utility matching the functionality of *Sugi Tools*. It bypasses credit limitations by using a self-hosted API processing pipeline.

## Architecture
- **Frontend (Vercel):** `apps/frontend`
  - Stack: Astro 5 + TailwindCSS v3.
  - UI Mode: Slate-Blue minimal dark theme, fully responsive.
- **Backend (VPS):** `apps/backend`
  - Stack: Node.js + Hono + PM2.
  - Services:
    - **Jina Reader API**: Proxied for text extraction (`markdown`, `html`, `crawl`).
    - **Cheerio**: Fast DOM parser for `images` extraction mode.
    - **Puppeteer (Headless Chrome)**: Real browser rendering to intercept CSS/DOM `getComputedStyle()` for `styleguide` and `design` generation.

## Implemented Features (6 Modes)
1. **Crawl Website**: Deep text extraction.
2. **Create Design MD**: Generates `DESIGN.md` (Markdown representation of fonts and colors).
3. **Scrape Markdown**: LLM-ready clean text.
4. **Scrape HTML**: Raw DOM structure extraction.
5. **Scrape Images**: Extracts all absolute URLs of `<img src="...">`.
6. **Extract Styleguide**: Scrapes active Fonts and Colors (RGB/LAB format) rendered by the browser.

## Deployment Details
### VPS (Backend)
- Location: `/opt/scraper-tools` on `ssh ditoaryap`.
- Process Manager: PM2 (`pm2 status scraper-backend`).
- Proxy: Nginx config at `/etc/nginx/sites-available/api-scraper`.
- SSL: Let's Encrypt / Certbot (`api-scraper.ditoaryap.web.id`).

### Vercel (Frontend)
- Deployed under team: `ditoaryap-work`.
- Repo: `ditoaryap-work/scraper-tools` (GitHub).

## Next Steps / Future Improvements
- The backend currently opens a new Puppeteer browser context for every styleguide request. Under heavy concurrent load, this could spike RAM on the 2GB VPS. Suggest implementing a persistent browser instance or concurrency limit using `puppeteer-cluster` if traffic scales.
- Currently lacks caching. We can introduce Redis or memory-cache for identical URLs to save processing time.
