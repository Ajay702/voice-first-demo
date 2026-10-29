// Records the silent screen videos for the Windcast demo.
//   node record.mjs part1|part2|all
// If voice/<part>.marks.json exists (from the voice studio), each scene is fitted to how
// long you actually spoke that section; otherwise scenes are paced to script.md's
// word counts. Writes out/<part>.mp4 and out/<part>.cues.json (when each scene starts).
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = process.env.APP_URL ?? 'https://vqmzk.vercel.app'
const REPO = process.env.REPO_URL ?? 'https://github.com/Ajay702/rqx4tn'
// Brave if installed (or BROWSER_PATH), otherwise Playwright's own Chromium.
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const BROWSER = process.env.BROWSER_PATH ?? (existsSync(BRAVE) ? BRAVE : undefined)
const OUT = fileURLToPath(new URL('./out/', import.meta.url))
const VOICE = fileURLToPath(new URL('./voice/', import.meta.url))
const W = 1920
const H = 1080
// Spoken pace used to size each section; slow enough to read without rushing.
const WPM = 110
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
const forWords = (n) => (n / WPM) * 60 + 3
// Pauses inside a scene are scaled by `pace` so the scene roughly fills its time slot.
// A pause that would run past the scene's slot is cut short, so a slow page load eats
// into idle time rather than pushing the next scene late.
let pace = 1
let slotEnd = Infinity
const hold = (s) => sleep(Math.max(0, Math.min(s * pace, (slotEnd - Date.now()) / 1000 - 1)))

// A visible cursor: headless recordings have none, and the viewer needs to see what's pointed at.
const CURSOR = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div')
  c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;' +
    'margin:-11px 0 0 -11px;border-radius:50%;background:rgba(239,68,68,.35);border:2px solid #ef4444;' +
    'left:-50px;top:-50px;transition:transform .15s'
  document.body.appendChild(c)
  addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', () => (c.style.transform = 'scale(.7)'), true)
  addEventListener('mouseup', () => (c.style.transform = ''), true)
})`

// Brave's headless screencast leaves out the bottom 81 px of the viewport, so the
// viewport is that much taller and the captured area is exactly W x H.
const HIDDEN_PX = 81
const FPS = 25

async function record(name, prepare, scenes) {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H + HIDDEN_PX },
    colorScheme: 'light',
    locale: 'en-GB',
  })
  await ctx.addInitScript(CURSOR)
  const page = await ctx.newPage()
  await prepare(page)

  // Screencast frames arrive only when the page changes; repeat the latest one at a
  // constant frame rate so the video keeps real time.
  const mp4 = join(OUT, `${name}.mp4`)
  const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg',
    '-framerate', String(FPS), '-i', '-', '-vf', `crop=${W}:${H}:0:0,format=yuv420p`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', mp4], { stdio: ['pipe', 'inherit', 'inherit'] })
  const cdp = await ctx.newCDPSession(page)
  let last = null
  cdp.on('Page.screencastFrame', (f) => {
    last = Buffer.from(f.data, 'base64')
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92 })
  while (!last) await sleep(0.05)
  const t0 = Date.now()
  let written = 0
  const pump = setInterval(() => {
    const due = Math.floor(((Date.now() - t0) / 1000) * FPS)
    for (; written < due; written++) ffmpeg.stdin.write(last)
  }, 1000 / FPS)

  // When each scene should end, measured from the start of the video.
  const ends = sceneEnds(name, scenes)
  const cues = []
  for (const [i, [section, words, run]] of scenes.entries()) {
    const began = Date.now()
    const at = (began - t0) / 1000
    cues.push({ section, at: +at.toFixed(2) })
    // Loose fit: stretch or squeeze the scene's pauses towards its slot, within limits.
    pace = Math.min(2.5, Math.max(0.4, (ends[i] - at) / forWords(words)))
    slotEnd = t0 + ends[i] * 1000
    await run(page)
    // Hold to the scene's end on the overall timeline, so an overrun is caught up later.
    const left = ends[i] - (Date.now() - t0) / 1000
    if (left > 0) await sleep(left)
    console.log(`  ${section}: ${((Date.now() - began) / 1000).toFixed(0)}s (slot ends ${ends[i].toFixed(0)}s)`)
  }
  clearInterval(pump)
  await cdp.send('Page.stopScreencast')
  const done = new Promise((r) => ffmpeg.on('close', r))
  ffmpeg.stdin.end()
  await done
  await browser.close()
  writeFileSync(join(OUT, `${name}.cues.json`), JSON.stringify(cues, null, 2))
  console.log(`→ ${mp4}`)
}

function sceneEnds(name, scenes) {
  const file = join(VOICE, `${name}.marks.json`)
  const nominal = []
  let t = 0
  for (const [, words] of scenes) nominal.push((t += forWords(words)))
  if (!existsSync(file)) {
    console.log(`${name}: no voice timings, pacing to the script`)
    return nominal
  }
  // marks: { starts: [seconds each section began in the recording], total: seconds }
  const { starts, total } = JSON.parse(readFileSync(file, 'utf8'))
  console.log(`${name}: fitting to your recording (${total.toFixed(0)}s, ${starts.length} sections)`)
  const ends = scenes.map((_, i) => (i + 1 < starts.length ? starts[i + 1] : null))
  // Sections you didn't mark (finished early) share the remaining time by word count.
  const known = Math.max(0, ...ends.filter((e) => e !== null))
  const rest = scenes.map(([, w], i) => (ends[i] === null ? forWords(w) : 0))
  const restSum = rest.reduce((a, b) => a + b, 0)
  let acc = known
  return ends.map((e, i) => {
    if (e !== null) return e
    acc += (rest[i] / restSum) * Math.max(total - known, 0)
    return acc
  })
}

// --- helpers --------------------------------------------------------------

let mouse = { x: W / 2, y: H / 2 }
async function moveTo(page, x, y, steps = 30) {
  await page.mouse.move(x, y, { steps })
  mouse = { x, y }
}
async function moveToEl(page, locator, dx = 0.5, dy = 0.5) {
  const b = await locator.boundingBox()
  await moveTo(page, b.x + b.width * dx, b.y + b.height * dy)
}
async function scrollSmooth(page, y) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y)
  await sleep(1.2)
}
async function scrollToEl(page, locator, offset = 90) {
  const y = await locator.evaluate((el, o) => el.getBoundingClientRect().top + window.scrollY - o, offset)
  await scrollSmooth(page, y)
}
const card = (page, title) => page.locator('.card, section').filter({ has: page.getByRole('heading', { name: title }) }).first()

// --- Part 1: client pitch on the live dashboard ----------------------------

const part1 = [
  ['Dashboard, top of page', 77, async (p) => {
    await hold(2)
    await moveTo(p, W * 0.3, 160, 40)
  }],
  ['Main chart: hover over a point', 78, async (p) => {
    const chart = p.locator('.recharts-wrapper').first()
    await scrollToEl(p, chart, 160)
    // Glide across the chart so the tooltip shows run time and lead time.
    for (const dx of [0.2, 0.35, 0.5, 0.62, 0.75]) {
      await moveToEl(p, chart, dx, 0.4)
      await hold(4)
    }
  }],
  ['KPI cards', 78, async (p) => {
    const kpis = p.locator('.kpis')
    await scrollToEl(p, kpis, 200)
    for (const i of [0, 2, 4]) {
      await moveToEl(p, kpis.locator('.kpi').nth(i), 0.5, 0.5)
      await hold(6)
    }
  }],
  ['Change cutoff, then fixed lead time', 31, async (p) => {
    await scrollSmooth(p, 0)
    const time = p.locator('input[type=time]')
    await moveToEl(p, time)
    await p.mouse.down(); await p.mouse.up()
    await time.fill('08:00')
    await hold(3)
    const radio = p.getByRole('radio', { name: 'Fixed lead time' })
    await moveToEl(p, radio)
    await radio.click()
    await hold(1.5)
    const slider = p.getByLabel('Lead time in hours')
    for (const h of [1, 6, 12, 24, 36, 48]) {
      const b = await slider.boundingBox()
      await moveTo(p, b.x + (b.width * h) / 48, b.y + b.height / 2, 12)
      await slider.fill(String(h))
      await hold(1.6)
    }
    const dayAhead = p.getByRole('radio', { name: 'Day-ahead decision' })
    await moveToEl(p, dayAhead)
    await dayAhead.click()
    await time.fill('10:00')
  }],
  ['Lead-time, by-hour and daily charts', 73, async (p) => {
    for (const title of ['Accuracy vs lead time', 'Error by time of day', 'Daily error']) {
      const c = card(p, title)
      await scrollToEl(p, c, 120)
      await moveToEl(p, c.locator('.recharts-wrapper'), 0.55, 0.5)
      await hold(title === 'Daily error' ? 8 : 11)
    }
  }],
  ['28 January: forecast evolution', 34, async (p) => {
    const day = p.getByLabel('Delivery day')
    await day.fill('2026-01-28')
    const c = p.locator('.recharts-wrapper').last()
    await scrollToEl(p, day, 140)
    await moveToEl(p, c, 0.3, 0.35)
    await hold(5)
    // The run-by-run tooltip is tall; move off the chart so the lines stay visible.
    await moveTo(p, W * 0.08, mouse.y, 25)
  }],
  ['Back to top', 30, async (p) => {
    await scrollSmooth(p, 0)
    await moveTo(p, W * 0.5, 300)
  }],
]

// --- Part 2: tech-lead walkthrough on GitHub -------------------------------

const blob = (path, lines = '') => `${REPO}/blob/main/${path}${lines}`

async function github(p, url) {
  await p.goto(url, { waitUntil: 'domcontentloaded' })
  // GitHub keeps background requests going, so never wait long for the network to go quiet.
  await p.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {})
  await sleep(0.5)
}
// Bring a line of a GitHub file view into view, and point at it.
async function showLine(p, n, secs) {
  const line = p.locator(`[data-line-number="${n}"], #L${n}`).first()
  await line.scrollIntoViewIfNeeded().catch(() => {})
  const y = await line.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 220).catch(() => null)
  if (y !== null) await scrollSmooth(p, y)
  const b = await line.boundingBox().catch(() => null)
  if (b) await moveTo(p, b.x + 420, b.y + b.height / 2, 25)
  await hold(secs)
}
async function readmeHeading(p, text, secs) {
  const h = p.locator('article').getByRole('heading', { name: text }).first()
  await scrollToEl(p, h, 80)
  await moveToEl(p, h, 0.1, 0.5)
  await hold(secs)
}

const part2 = [
  ['GitHub repo, README architecture', 91, async (p) => {
    await moveTo(p, 600, 400, 30)
    await hold(8)
    await readmeHeading(p, 'Architecture', 14)
    await readmeHeading(p, 'Repository layout', 10)
  }],
  ['backend/app/analysis.py', 150, async (p) => {
    await github(p, blob('backend/app/analysis.py', '#L40-L61'))
    await showLine(p, 40, 8)
    await showLine(p, 53, 14)        // hindcast rows dropped
    await showLine(p, 70, 18)        // latest_before: bisect
    await showLine(p, 82, 20)        // decision_cutoff: day-ahead vs fixed lead time
    await showLine(p, 104, 14)       // select_forecasts
  }],
  ['backend/app/main.py', 38, async (p) => {
    await github(p, blob('backend/app/main.py', '#L74-L90'))
    await showLine(p, 74, 10)
    await showLine(p, 117, 6)
  }],
  ['frontend/src', 32, async (p) => {
    await github(p, `${REPO}/tree/main/frontend/src`)
    await moveTo(p, 500, 380, 25)
    await hold(5)
    await github(p, blob('frontend/src/charts.tsx', '#L33'))
    await showLine(p, 33, 5)
  }],
  ['Tests and delivery', 57, async (p) => {
    await github(p, blob('backend/tests/test_analysis.py', '#L57-L61'))
    await showLine(p, 34, 5)
    await showLine(p, 57, 6)
    await github(p, blob('e2e/app.spec.ts'))
    await moveTo(p, 700, 450, 25)
    await hold(6)
    await github(p, blob('Dockerfile'))
    await moveTo(p, 700, 420, 25)
    await hold(6)
    await github(p, blob('vercel.json'))
    await moveTo(p, 700, 420, 25)
  }],
  ['README: AI note and next steps', 74, async (p) => {
    await github(p, REPO)
    await readmeHeading(p, 'AI tools', 12)
    await readmeHeading(p, 'Running it', 12)
    await p.goto(APP, { waitUntil: 'networkidle' })
    await moveTo(p, W * 0.5, 300, 30)
  }],
]

const which = process.argv[2] ?? 'all'
const loadApp = async (p) => {
  await p.goto(APP, { waitUntil: 'networkidle' })
  await p.locator('.recharts-wrapper').first().waitFor()
  await sleep(1)
}
if (which === 'part1' || which === 'all') await record('part1', loadApp, part1)
if (which === 'part2' || which === 'all') await record('part2', (p) => github(p, REPO), part2)
