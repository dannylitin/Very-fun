# Public Type — Font Preview Widget

An embeddable font-preview tool for the Public Type website. Visitors paste in their own website URL and see it rendered with Public Type fonts applied in real time — like a live, in-browser type tester.

---

## Project structure

```
Very-fun/
├── widget.html          ← Frontend embed (drop into Framer)
├── proxy/
│   ├── server.js        ← Node.js/Express proxy server
│   ├── package.json
│   ├── vercel.json      ← Vercel deployment config
│   ├── .env.example
│   └── .gitignore
└── README.md
```

---

## How it works

```
Visitor browser
  │
  ├─ widget.html (Framer embed)
  │     • URL input
  │     • Font selector sidebar
  │     • <iframe> pointing at proxy
  │
  └─ POST  /proxy?url=https://brand.com
          │
          └─ proxy/server.js (Vercel / Railway)
                • Fetches brand.com server-side
                • Strips X-Frame-Options / CSP headers
                • Injects font-switching <script>
                • Returns modified HTML
```

The widget and the proxied page communicate via `window.postMessage`. When a user selects a font the widget sends a `PT_APPLY_FONT` message to the iframe; the injected script applies it with `!important` overrides.

---

## 1 — Deploy the proxy

### Vercel (recommended)

```bash
cd proxy
npm install
npx vercel deploy --prod
```

Vercel will give you a URL like `https://pt-font-proxy.vercel.app`.

### Railway

1. Push the `proxy/` folder to its own GitHub repo (or a sub-path).
2. Create a new Railway project and point it at that repo.
3. Railway auto-detects `package.json`; set the start command to `node server.js`.
4. Set the `PORT` environment variable to `3000` (Railway sets `$PORT` automatically).

### Local development

```bash
cd proxy
cp .env.example .env
npm install
npm run dev           # uses node --watch (Node 18+)
```

The proxy listens on `http://localhost:3000` by default.

### Environment variables

| Variable          | Default | Description |
|-------------------|---------|-------------|
| `PORT`            | `3000`  | Port the server listens on |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated CORS origins. Leave blank for open access. |

---

## 2 — Connect the widget

Open `widget.html` and find this line near the top of the `<script>` block:

```js
return 'https://pt-font-proxy.vercel.app';
```

Replace the URL with your deployed proxy URL, then save.

Alternatively, set the global variable `window.PT_PROXY_URL` before the widget script runs:

```html
<script>window.PT_PROXY_URL = 'https://your-proxy.vercel.app';</script>
<!-- then paste widget.html contents -->
```

---

## 3 — Embed in Framer

### Option A — Iframe embed

Host `widget.html` on any static host (GitHub Pages, Vercel, Netlify) and embed it in Framer:

1. In Framer, add an **Embed** component.
2. Set the embed type to **URL** and paste the hosted widget URL.
3. Set width to `100%` and height to whatever your design calls for (e.g. `700px`).

### Option B — Custom Code Component

1. Copy the entire contents of `widget.html`.
2. In Framer, open **Site Settings → Custom Code** and paste into the `<body>` section.
3. Or create a **Custom Component** and return the widget markup directly.

---

## 4 — Swap in real Public Type fonts

Placeholder fonts are defined in the `FONTS` array inside `widget.html`:

```js
const FONTS = [
  {
    name: 'Space Grotesk',       // ← displayed name
    category: 'Geometric Sans',  // ← tag shown in sidebar
    googleFontFamily: 'Space+Grotesk:wght@400;500;700',  // Google Fonts query string
    cssFamily: "'Space Grotesk', sans-serif",             // CSS font-family value
  },
  // …
];
```

To use real Public Type font files instead of Google Fonts:

1. **Host the font files** (WOFF2 recommended) on a CDN or the Public Type site.
2. **Create a CSS stylesheet** (e.g. `pt-fonts.css`) with `@font-face` declarations:
   ```css
   @font-face {
     font-family: 'PT Neue';
     src: url('https://cdn.publictype.co/fonts/PTNeue-Regular.woff2') format('woff2');
     font-weight: 400;
   }
   ```
3. **Update the `FONTS` array** in `widget.html`:
   ```js
   {
     name: 'PT Neue',
     category: 'Geometric Sans',
     googleFontFamily: null,                      // no Google Font
     cssFamily: "'PT Neue', sans-serif",
     customCssUrl: 'https://cdn.publictype.co/pt-fonts.css',  // your stylesheet
   }
   ```
4. **Update `applyFontToFrame()`** to send `customCssUrl` instead of `googleFontUrl` when it's set:
   ```js
   frame.contentWindow.postMessage({
     type: 'PT_APPLY_FONT',
     fontFamily: font.cssFamily,
     target,
     googleFontUrl: font.customCssUrl || buildGoogleFontUrl(font),
   }, '*');
   ```
   The proxy-injected script already handles any stylesheet URL in the `googleFontUrl` field.

---

## Placeholder fonts (used until real fonts are ready)

| Slot | Font | Category |
|------|------|----------|
| 1 | Space Grotesk | Geometric Sans |
| 2 | Inter | Humanist Sans |
| 3 | Playfair Display | Serif |
| 4 | Fraunces | Display / Headline |
| 5 | JetBrains Mono | Monospace |

---

## Limitations & known caveats

- **Single-page apps (React, Vue, etc.)** — because the proxy only rewrites the initial HTML, client-side-rendered content may not have fonts applied until the user interacts with the page. This is a known limitation of the approach.
- **Sites that require authentication** — the proxy cannot log in; authenticated pages will redirect to a login screen.
- **Sites that block all bots** — a small number of sites serve blank pages to non-browser user agents even when headers are spoofed.
- **HTTPS mixed content** — all proxied assets resolve against the original domain directly, so images/fonts/CSS from `http://` origins may be blocked by the browser on an `https://` proxy. Affect is cosmetic only.

---

## Future enhancements (v2 ideas)

- **Font pairing mode** — separate heading and body font selectors
- **Weight/style selector** — light, regular, medium, bold per family
- **Shareable link** — encode URL + font selection in the hash for easy team sharing
- **Export screenshot** — server-side render with Puppeteer and download a PNG
- **"Get a quote" CTA** — deep-link to the Public Type licensing page with the selected font pre-filled

---

## License

Internal project — Public Type. Not for redistribution.
