Recursive Ord Scanner

Overview

- Small local server to batch-screenshot Magic Eden Ordinals previews that render inside a sandboxed iframe after several seconds.
- Reads an incoming JSON (e.g., `incoming/flares.json`), visits each `contentPreviewURI`, waits for render/network to settle, and saves `PNG` screenshots to `../../collection/<jsonNameWithoutExt>/` as `<jsonName>.<index>.<id>.png`.

Install

1. From this folder (`tools/recursive-ord-scanner`):
   - npm install
   - npx playwright install chromium

Run

1. Start the server:
   - npm run start
2. Open the UI:
   - http://localhost:3333
3. Choose your incoming JSON (e.g., `flares.json`), tweak options (viewport size, delay, headless), and click Start.

Output

- Screenshots are saved to: `vaultImages/collection/<jsonNameWithoutExt>/<jsonName>.<index>.<id>.png`
- Example for `incoming/flares.json`:
  - `vaultImages/collection/flares/flares.json.0.ea149dae646ba040a1342a65ecbdfb873b435d26813011a73cf397add06f2b13i178.png`

Notes / Tips

- Rendering wait: the preview uses a sandboxed `iframe` with `srcdoc` that fetches assets and initializes Three.js. The worker waits for `networkidle` and then an additional delay (default 2000ms) before capturing.
- If you see blank/black canvases in headless mode, set Headless to `false` in the UI to render with a visible browser window.
- You can adjust viewport size to fit your target resolution (e.g., 1600x1200 or 1600x1600).
- Existing files are skipped by default; toggle this off to re-capture.

Configuration

- ENV `PORT`: server port (default 3333)
- ENV `OUTPUT_ROOT`: override default output root (`../../collection` relative to this folder)

