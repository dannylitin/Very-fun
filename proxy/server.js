'use strict';

/* Disable TLS certificate verification — required in Vercel's serverless
   environment where the system CA bundle is unavailable. This proxy fetches
   public websites on behalf of the user so strict cert checking is not needed. */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * Public Type — Font Preview Proxy
 *
 * Fetches target websites server-side, strips iframe-blocking headers,
 * injects the font-switching runtime, and serves the result so it can
 * load inside the widget's <iframe>.
 */

const express    = require('express');
const fetch      = require('node-fetch');
const { JSDOM }  = require('jsdom');
const { URL }    = require('url');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Allowed origins for CORS ──────────────────────────────────────── */
// Set ALLOWED_ORIGINS in .env as a comma-separated list.
// Leave empty to allow all origins (fine for a public demo tool).
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

/* ── CORS middleware ───────────────────────────────────────────────── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowedOrigins.length || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ── Security: block private / local addresses ─────────────────────── */
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i;

function isSafeUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (BLOCKED_HOSTS.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/* ── Font-switching runtime injected into every proxied page ─────── */
const FONT_RUNTIME = `
<script data-pt-runtime="1">
(function () {
  'use strict';

  var originalStyles = new WeakMap();
  var loadedFonts    = {};
  var activeFontUrl  = null;

  /* Tell the parent we're ready */
  function notifyReady() {
    try { window.parent.postMessage({ type: 'PT_READY' }, '*'); } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReady);
  } else {
    notifyReady();
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;

    if (d.type === 'PT_APPLY_FONT') {
      applyFont(d.fontFamily, d.target, d.googleFontUrl);
    }
    if (d.type === 'PT_RESET_FONTS') {
      resetFonts();
    }
  });

  /* Load a Google Font stylesheet once, then apply the family */
  function applyFont(fontFamily, target, googleFontUrl) {
    if (googleFontUrl && !loadedFonts[googleFontUrl]) {
      var link = document.createElement('link');
      link.rel  = 'stylesheet';
      link.href = googleFontUrl;
      link.setAttribute('data-pt-font', '1');
      document.head.appendChild(link);
      loadedFonts[googleFontUrl] = true;
    }
    activeFontUrl = googleFontUrl;

    var selector = buildSelector(target);
    var elements = document.querySelectorAll(selector);
    elements.forEach(function (el) {
      if (!originalStyles.has(el)) {
        originalStyles.set(el, el.style.fontFamily || '');
      }
      el.style.setProperty('font-family', fontFamily, 'important');
    });
  }

  function buildSelector(target) {
    if (target === 'headings') return 'h1,h2,h3,h4,h5,h6';
    if (target === 'body')     return 'p,li,td,th,label,blockquote,figcaption,span,a,button,input,textarea,select';
    /* 'all' — every visible text-bearing element; avoid SVG internals */
    return 'body *:not(script):not(style):not(noscript):not(svg *)';
  }

  function resetFonts() {
    var selector = 'h1,h2,h3,h4,h5,h6,p,li,td,th,label,blockquote,figcaption,span,a,button,input,textarea,select,body *';
    var elements = document.querySelectorAll(selector);
    elements.forEach(function (el) {
      if (originalStyles.has(el)) {
        el.style.fontFamily = originalStyles.get(el);
      }
    });
    originalStyles = new WeakMap();
  }
})();
<\/script>
`.trim();

/* ── Headers we strip from the upstream response ─────────────────── */
const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-security-policy',
  'x-webkit-csp',
  'strict-transport-security',       // let the proxy handle transport
  'transfer-encoding',               // Express handles this
  'connection',
  'keep-alive',
]);

/* ── Resolve a possibly-relative URL against a base ──────────────── */
function resolveUrl(href, base) {
  if (!href) return href;
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/* ── Rewrite the HTML with JSDOM ─────────────────────────────────── */
function rewriteHtml(html, targetUrl) {
  let dom;
  try {
    dom = new JSDOM(html, { url: targetUrl });
  } catch (e) {
    dom = new JSDOM(html);
  }
  const doc = dom.window.document;

  /* Inject <base> so relative URLs resolve against the target origin */
  if (!doc.querySelector('base[href]')) {
    const base  = doc.createElement('base');
    base.href   = targetUrl;
    const head  = doc.querySelector('head') || doc.documentElement;
    head.insertBefore(base, head.firstChild);
  }

  /* Remove existing meta CSP tags */
  doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(el => el.remove());
  doc.querySelectorAll('meta[http-equiv="X-Frame-Options"]').forEach(el => el.remove());

  /* Inject our font-switching runtime just before </body> */
  const body = doc.querySelector('body');
  if (body) {
    const wrapper = doc.createRange().createContextualFragment(FONT_RUNTIME);
    body.appendChild(wrapper);
  } else {
    // Fallback: append to html element
    const frag = dom.window.document.createRange().createContextualFragment(FONT_RUNTIME);
    doc.documentElement.appendChild(frag);
  }

  return dom.serialize();
}

/* ── /proxy endpoint ─────────────────────────────────────────────── */
app.get('/proxy', async (req, res) => {
  const rawUrl = req.query.url;

  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing `url` query parameter.' });
  }

  if (!isSafeUrl(rawUrl)) {
    return res.status(400).json({ error: 'Invalid or disallowed URL.' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl).href;
  } catch {
    return res.status(400).json({ error: 'Malformed URL.' });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control':   'no-cache',
      },
      redirect:  'follow',
      timeout:   15000,       // 15-second timeout (node-fetch v2)
    });

    // Determine content type
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    // Build clean response headers
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!STRIP_HEADERS.has(key.toLowerCase())) {
        outHeaders[key] = value;
      }
    });

    // Always allow iframe embedding
    outHeaders['x-frame-options']         = '';          // empty = no restriction
    outHeaders['content-security-policy'] = '';
    outHeaders['cache-control']           = 'no-store';

    if (contentType.includes('text/html')) {
      const html      = await upstream.text();
      const rewritten = rewriteHtml(html, upstream.url || targetUrl);

      // Deliver with explicit UTF-8 charset
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      // Apply the rest of the clean headers (skip content-type, already set)
      Object.entries(outHeaders).forEach(([k, v]) => {
        if (k.toLowerCase() !== 'content-type' && v) {
          try { res.setHeader(k, v); } catch (_) {}
        }
      });

      return res.send(rewritten);
    }

    // Non-HTML resources: pass through as-is
    // (CSS, images, fonts, JS loaded by the proxied page's base tag will
    //  resolve directly against the target origin — no proxy needed.)
    const buffer = await upstream.buffer();

    Object.entries(outHeaders).forEach(([k, v]) => {
      if (v) {
        try { res.setHeader(k, v); } catch (_) {}
      }
    });

    res.status(upstream.status).send(buffer);

  } catch (err) {
    console.error('[proxy] fetch error:', err.message);

    if (err.type === 'request-timeout' || err.code === 'ECONNRESET') {
      return res.status(504).json({ error: 'Upstream request timed out.' });
    }
    if (err.code === 'ENOTFOUND') {
      return res.status(502).json({ error: 'Could not resolve the target domain.' });
    }
    return res.status(502).json({ error: `Upstream error: ${err.message}` });
  }
});

/* ── Health check ─────────────────────────────────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pt-font-proxy' }));

/* ── 404 catch-all ────────────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ── Start ────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`Public Type proxy running on port ${PORT}`);
});

module.exports = app; // for testing
