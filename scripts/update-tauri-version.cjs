const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
const updated = tauriConf.replace(
  /("version"\s*:\s*")[^"]+(")/,
  `$1${packageJson.version}$2`,
);

fs.writeFileSync(tauriConfPath, updated, 'utf8');
