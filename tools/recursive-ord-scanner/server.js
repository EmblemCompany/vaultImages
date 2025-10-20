import fs from 'fs';
import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config
const INCOMING_DIR = path.resolve(__dirname, 'incoming');
// Default output root as described: ../../collection
const OUTPUT_ROOT = process.env.OUTPUT_ROOT
  ? path.resolve(process.env.OUTPUT_ROOT)
  : path.resolve(__dirname, '..', '..', 'collection');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple in-memory job tracking
const jobs = new Map(); // key: jobId, value: { status, progress, total, file, startedAt, finishedAt, log[] }

// Serve a minimal UI
app.use('/static', express.static(path.resolve(__dirname, 'public')));

app.get('/', async (req, res) => {
  const files = await listIncomingJsonFiles();
  res.send(renderIndex(files));
});

// Start capture for a specific JSON file
app.post('/start', async (req, res) => {
  try {
    const { file, symbol, headless, width, height, delayMs, concurrency, timeoutMs, skipExisting } = req.body;
    let filePath = null;
    let mode = 'file';
    if (symbol && String(symbol).trim().length > 0) {
      mode = 'symbol';
    } else {
      if (!file || typeof file !== 'string') {
        return res.status(400).json({ error: 'Provide a collection symbol or select a JSON' });
      }
      filePath = path.resolve(INCOMING_DIR, file);
      if (!filePath.startsWith(INCOMING_DIR) || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Invalid file' });
      }
    }

    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      status: 'queued',
      progress: 0,
      total: 0,
      file,
      startedAt: null,
      finishedAt: null,
      log: []
    };
    jobs.set(jobId, job);

    // Fire-and-forget run
    runCaptureJob({
      jobId,
      filePath,
      symbol: mode === 'symbol' ? String(symbol).trim() : null,
      headless: parseBoolean(headless, true),
      viewport: { width: toInt(width, 1400), height: toInt(height, 1050) },
      delayMs: toInt(delayMs, 2000),
      concurrency: Math.min(Math.max(toInt(concurrency, 1), 1), 4),
      timeoutMs: toInt(timeoutMs, 45000),
      skipExisting: parseBoolean(skipExisting, true)
    }).catch(err => {
      appendJobLog(jobId, `Job failed: ${err?.message || err}`);
      setJobStatus(jobId, 'failed');
    });

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Get job status
app.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

// SSE for progress
app.get('/events/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Initial push
  try { res.write(`data: ${JSON.stringify(jobs.get(jobId))}\n\n`); } catch {}

  const interval = setInterval(() => {
    const j = jobs.get(jobId);
    if (j) {
      try { res.write(`data: ${JSON.stringify(j)}\n\n`); } catch {}
    } else {
      // Heartbeat comment to keep connection alive
      res.write(`: ping\n\n`);
    }
    if (j && (j.status === 'completed' || j.status === 'failed')) {
      clearInterval(interval);
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

const port = toInt(process.env.PORT, 3333);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`[server] http://${host}:${port}`);
  console.log(`[server] Incoming dir: ${INCOMING_DIR}`);
  console.log(`[server] Output root: ${OUTPUT_ROOT}`);
});

// ---- Helpers & Worker ----

async function listIncomingJsonFiles() {
  const entries = await fs.promises.readdir(INCOMING_DIR);
  return entries.filter(f => f.toLowerCase().endsWith('.json')).sort();
}

function renderIndex(files) {
  const items = files.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Recursive Ord Scanner</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 20px; }
      label { display:block; margin: 8px 0 4px; }
      input, select { padding: 6px 8px; }
      .row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
      .muted { color: #666; }
      .log { background: #111; color: #ddd; padding: 8px; height: 220px; overflow: auto; white-space: pre-wrap; }
      button { padding: 8px 12px; }
    </style>
  </head>
  <body>
    <h1>Recursive Ord Scanner</h1>
    <form id="form">
      <label>Collection symbol (Magic Eden)</label>
      <input name="symbol" placeholder="e.g., flares" style="width:200px" />
      <div class="muted" style="margin:4px 0 10px;">If symbol provided, JSON selection below is ignored.</div>
      <label>Incoming JSON (optional)</label>
      <select name="file">${items}</select>
      <div class="row">
        <label>Viewport (WxH)</label>
        <input type="number" name="width" value="1400" min="256" step="1" style="width:100px" />
        <input type="number" name="height" value="1400" min="256" step="1" style="width:100px" />
        <label>Delay after idle (ms)</label>
        <input type="number" name="delayMs" value="2000" min="0" step="100" style="width:120px" />
        <label>Per-item timeout (ms)</label>
        <input type="number" name="timeoutMs" value="45000" min="5000" step="1000" style="width:130px" />
        <label>Headless</label>
        <select name="headless"><option value="true" selected>true</option><option value="false">false</option></select>
        <label>Skip existing</label>
        <select name="skipExisting"><option value="true" selected>true</option><option value="false">false</option></select>
      </div>
      <div class="row" style="margin-top:12px;">
        <button type="button" id="startBtn">Start Capture</button>
      </div>
    </form>
    <div id="status" class="muted" style="margin: 12px 0 6px;"></div>
    <div class="log" id="log"></div>
    <script src="/static/app.js" defer></script>
  </body>
  </html>`;
}

function parseBoolean(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setJobStatus(jobId, status) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  if (status === 'running') job.startedAt = new Date().toISOString();
  if (status === 'completed' || status === 'failed') job.finishedAt = new Date().toISOString();
}

function appendJobLog(jobId, line) {
  const job = jobs.get(jobId);
  if (!job) return;
  const timestamp = new Date().toISOString().split('T')[1].replace('Z','');
  job.log.push(`[${timestamp}] ${line}`);
}

async function runCaptureJob(options) {
  const { jobId, filePath, symbol, headless, viewport, delayMs, concurrency, timeoutMs, skipExisting } = options;

  setJobStatus(jobId, 'running');

  let tokens = [];
  let outDirName = '';
  if (symbol) {
    outDirName = sanitizeFilePart(symbol);
    appendJobLog(jobId, `Fetching tokens for symbol: ${symbol}`);
    tokens = await fetchAllTokensForSymbol(jobId, symbol).catch(err => {
      throw new Error(`Failed to fetch tokens: ${err?.message || err}`);
    });
  } else {
    appendJobLog(jobId, `Reading ${filePath}`);
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    tokens = Array.isArray(data?.tokens) ? data.tokens : [];
    const baseJsonName = path.basename(filePath); // e.g., flares.json
    outDirName = baseJsonName.replace(/\.[^/.]+$/, '');
  }

  // Ensure fresh output directory at ../../collection/<outDirName>
  const outDir = path.resolve(OUTPUT_ROOT, outDirName);
  await fs.promises.rm(outDir, { recursive: true, force: true }).catch(() => {});
  await fs.promises.mkdir(outDir, { recursive: true });

  const job = jobs.get(jobId);
  job.total = tokens.length;
  appendJobLog(jobId, `Found ${tokens.length} tokens`);
  appendJobLog(jobId, `Output dir: ${outDir}`);

  // Create browser once, reuse pages sequentially for reliability
  const browser = await chromium.launch({ headless, args: [
    // Hints for WebGL/Three.js stability in headless
    '--use-angle=metal',
    '--enable-features=CanvasOopRasterization,Canvas2DLayers',
  ]});
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    for (let i = 0; i < tokens.length; i++) {
      job.progress = i;
      const t = tokens[i];
      const id = String(t.id || '').trim();
      const url = t.contentPreviewURI || t.contentURI || '';
      if (!url) {
        appendJobLog(jobId, `(${i + 1}/${tokens.length}) Missing URL for id=${id}`);
        continue;
      }

      const fileName = `${sanitizeFilePart(id)}.png`;
      const outPath = path.resolve(outDir, fileName);

      if (skipExisting && fs.existsSync(outPath)) {
        appendJobLog(jobId, `(${i + 1}/${tokens.length}) Skip exists → ${fileName}`);
        continue;
      }

      appendJobLog(jobId, `(${i + 1}/${tokens.length}) Navigating → ${url}`);
      try {
        await page.setViewportSize(viewport);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});

        // Try network idle to let iframe finish fetching assets
        try {
          await page.waitForLoadState('networkidle', { timeout: timeoutMs });
        } catch (_) {
          // ignore and proceed with fallback delay
        }

        // Fallback: wait a bit extra for render to stabilize
        if (delayMs > 0) await page.waitForTimeout(delayMs);

        // Best-effort: ensure iframe is visible (top-level only; we can't pierce sandboxed srcdoc)
        try {
          await page.waitForSelector('iframe#content-iframe', { timeout: Math.min(5000, timeoutMs) });
        } catch (_) {}

        // Enforce square screenshot using centered square crop
        let clip = null;
        try {
          const iframeEl = await page.$('iframe#content-iframe');
          if (iframeEl) {
            const box = await iframeEl.boundingBox();
            if (box && box.width > 0 && box.height > 0) {
              clip = squareClip(box);
            }
          }
        } catch (_) { /* ignore */ }
        if (!clip) {
          const vp = page.viewportSize() || viewport;
          clip = squareClip({ x: 0, y: 0, width: vp.width, height: vp.height });
        }
        await page.screenshot({ path: outPath, clip });
        appendJobLog(jobId, `Saved ${fileName}`);
      } catch (err) {
        appendJobLog(jobId, `Error on id=${id}: ${err?.message || err}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  jobs.get(jobId).progress = tokens.length;
  setJobStatus(jobId, 'completed');
  appendJobLog(jobId, 'Job complete');
}

function sanitizeFilePart(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200);
}

function squareClip(box) {
  // Create a centered integer square clip from a given box
  const x = Number(box.x) || 0;
  const y = Number(box.y) || 0;
  const w = Math.max(0, Math.floor(Number(box.width) || 0));
  const h = Math.max(0, Math.floor(Number(box.height) || 0));
  const s = Math.max(1, Math.min(w, h));
  const cx = x + w / 2;
  const cy = y + h / 2;
  let left = Math.round(cx - s / 2);
  let top = Math.round(cy - s / 2);
  // Ensure non-negative
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  return { x: left, y: top, width: s, height: s };
}

async function fetchAllTokensForSymbol(jobId, symbol, pageSize = 100) {
  const tokens = [];
  let offset = 0;
  const base = 'https://api-mainnet.magiceden.us/v2/ord/btc/tokens';
  for (;;) {
    const params = new URLSearchParams();
    params.set('offset', String(offset));
    params.set('limit', String(pageSize));
    // API expects array-style param
    params.append('collectionSymbol[]', symbol);
    params.set('sortBy', 'inscriptionNumberAsc');
    params.set('disablePendingTransactions', 'false');
    params.set('showAll', 'true');
    params.set('rbfPreventionListingOnly', 'false');
    const url = `${base}?${params.toString()}`;
    appendJobLog(jobId, `Fetching ${url}`);
    const res = await robustFetch(url, { headers: { 'User-Agent': 'recursive-ord-scanner/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const page = Array.isArray(json?.tokens) ? json.tokens : (Array.isArray(json) ? json : []);
    if (!Array.isArray(page)) throw new Error('Unexpected response');
    tokens.push(...page);
    appendJobLog(jobId, `Fetched ${page.length} (total ${tokens.length})`);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return tokens;
}

async function robustFetch(url, init, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastErr = err;
    }
    const backoff = 500 * Math.pow(2, attempt);
    await new Promise(r => setTimeout(r, backoff));
  }
  throw lastErr || new Error('Network error');
}
