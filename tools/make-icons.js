// Renders the Sabir logo into PNG/ICO assets. Run: electron tools/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const ASSETS = path.join(__dirname, '..', 'assets');
const logoJs = fs.readFileSync(path.join(__dirname, '..', 'ui', 'logo.js'), 'utf8');
const css = `@font-face{font-family:'Cinzel';src:url('file:///${path.join(__dirname, '..', 'ui', 'fonts', 'Cinzel-VF.ttf').split(path.sep).join('/')}');font-weight:400 900}`;

async function render(win, size, pad) {
  const html = `<html><head><style>${css} html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>
    <div id="l" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"></div>
    <script>${logoJs}; document.getElementById('l').innerHTML = sabirLogo(${size - pad * 2}, ${Math.round((size - pad * 2) * 182 / 204)}, false);</script></body></html>`;
  const file = path.join(app.getPath('temp'), 'sabir-icon.html');
  fs.writeFileSync(file, html);
  win.setContentSize(size, size);
  await win.loadFile(file);
  await document_fonts(win);
  const img = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    win.webContents.once('paint', (_e, _dirty, image) => { clearTimeout(t); resolve(image); });
    win.webContents.invalidate();
  });
  if (!img) throw new Error('no paint for ' + size);
  return img.crop({ x: 0, y: 0, width: Math.min(size, img.getSize().width), height: Math.min(size, img.getSize().height) }).resize({ width: size, height: size }).toPNG();
}
async function document_fonts(win) { await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 150)))'); }

function ico(pngs) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  setTimeout(() => { console.log('timeout'); app.exit(1); }, 60000);
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true }, width: 256, height: 256 });
  win.webContents.setFrameRate(10);
  const out = [];
  await render(win, 64, 0); // warm-up: the very first paint can come back empty
  for (const s of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
    let buf = Buffer.alloc(0);
    for (let i = 0; i < 4 && buf.length === 0; i++) buf = await render(win, s, s <= 32 ? 0 : Math.round(s * 0.04));
    if (!buf.length) throw new Error("empty icon " + s);
    out.push({ size: s, buf });
  }
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), out.find((o) => o.size === 16).buf);
  fs.writeFileSync(path.join(ASSETS, 'tray@2x.png'), out.find((o) => o.size === 32).buf);
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), out.find((o) => o.size === 256).buf);
  fs.writeFileSync(path.join(ASSETS, 'icon-png.ico'), ico(out.filter((o) => [16, 20, 24, 32, 40, 48, 64, 256].includes(o.size))));
  // per-size PNGs; tools/make-ico.py turns them into a classic BMP-based icon.ico
  fs.mkdirSync(path.join(ASSETS, 'sizes'), { recursive: true });
  for (const o of out) fs.writeFileSync(path.join(ASSETS, 'sizes', `${o.size}.png`), o.buf);
  console.log('icons written');
  app.quit();
});
