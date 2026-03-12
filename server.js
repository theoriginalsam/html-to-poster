const express = require('express');
const multer  = require('multer');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const upload = multer({ dest: os.tmpdir() });

app.use(express.static(path.join(__dirname, 'public')));

app.post('/convert', upload.single('htmlfile'), async (req, res) => {
  const { width, height, unit, scale } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No HTML file uploaded.' });

  const w = parseFloat(width);
  const h = parseFloat(height);
  const u = unit || 'in';
  const userScale = parseFloat(scale) || 1;

  // Convert to inches for internal use
  const toInches = (val, unit) => {
    if (unit === 'in') return val;
    if (unit === 'cm') return val / 2.54;
    if (unit === 'mm') return val / 25.4;
    if (unit === 'px') return val / 96;
    return val;
  };

  const wIn = toInches(w, u);
  const hIn = toInches(h, u);

  // PDF pixel dimensions at 96 DPI
  const pdfW = Math.round(wIn * 96);
  const pdfH = Math.round(hIn * 96);

  // Rename to .html so Puppeteer renders it as a webpage, not plain text
  const htmlPath = req.file.path + '.html';
  fs.renameSync(req.file.path, htmlPath);
  const outPath  = path.join(os.tmpdir(), `poster_${Date.now()}.pdf`);

  try {
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
    });
    const page = await browser.newPage();

    // Large viewport so content isn't clipped
    await page.setViewport({ width: Math.max(pdfW, 1440), height: Math.max(pdfH, 1080) });

    const fileUrl = 'file://' + htmlPath;
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    // Get the natural size of the poster element (or body)
    const contentSize = await page.evaluate(() => {
      const el = document.querySelector('.poster') || document.body;
      return { w: el.scrollWidth, h: el.scrollHeight };
    });

    const scaleX = pdfW / contentSize.w;
    const scaleY = pdfH / contentSize.h;
    const autoScale = Math.min(scaleX, scaleY) * userScale;

    await page.addStyleTag({ content: `
      html, body {
        width: ${pdfW}px !important;
        height: ${pdfH}px !important;
        background: white !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .poster, body > * {
        transform: scale(${autoScale}) !important;
        transform-origin: top left !important;
      }
    `});

    await page.pdf({
      path: outPath,
      width:  `${pdfW}px`,
      height: `${pdfH}px`,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    await browser.close();

    res.download(outPath, `poster_${w}x${h}${u}.pdf`, () => {
      fs.unlinkSync(htmlPath);
      fs.unlinkSync(outPath);
    });

  } catch (err) {
    console.error(err);
    fs.unlinkSync(htmlPath);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`HTMLtoPoster running at http://localhost:${PORT}`));
