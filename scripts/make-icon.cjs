const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const input = path.join(__dirname, '..', 'public', 'MineBench.png');
const outDir = path.join(__dirname, '..', 'build');
const outIco = path.join(outDir, 'icon.ico');
const outPng = path.join(outDir, 'icon.png');

(async () => {
  try {
    if (!fs.existsSync(input)) {
      console.error('Input PNG not found:', input);
      process.exit(1);
    }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    fs.copyFileSync(input, outPng);
    const buf = await pngToIco(input);
    fs.writeFileSync(outIco, buf);
    console.log('Icon PNG written to', outPng);
    console.log('Icon ICO written to', outIco);
  } catch (err) {
    console.error('Failed to create icon:', err);
    process.exit(1);
  }
})();