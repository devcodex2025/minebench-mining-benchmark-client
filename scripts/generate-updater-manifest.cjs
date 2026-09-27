const fs = require('node:fs');
const path = require('node:path');

const artifactRoot = path.resolve(process.argv[2] || 'src-tauri/target/release/bundle');
const outputPath = path.resolve(process.argv[3] || path.join(artifactRoot, 'latest.json'));
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const downloadBase = 'https://bitbucket.org/minebenchapp/minebench-client/downloads/';

const files = fs.readdirSync(artifactRoot, { recursive: true })
  .map((entry) => path.join(artifactRoot, String(entry)))
  .filter((entry) => fs.statSync(entry).isFile());

const signedArtifacts = files
  .filter((entry) => entry.endsWith('.sig'))
  .map((signaturePath) => ({
    signaturePath,
    artifactPath: signaturePath.slice(0, -4),
  }))
  .filter(({ artifactPath }) => fs.existsSync(artifactPath));

const architecture = (name) => {
  if (/aarch64|arm64/i.test(name)) return 'aarch64';
  if (/i686|x86(?!_64)/i.test(name)) return 'i686';
  if (/armv7/i.test(name)) return 'armv7';
  return 'x86_64';
};

const targets = (artifactPath) => {
  const name = path.basename(artifactPath);
  if (/\.AppImage$/i.test(name)) return [`linux-${architecture(name)}`];
  if (/\.(exe|msi)$/i.test(name)) return [`windows-${architecture(name)}`];
  if (/\.tar\.gz$/i.test(name)) {
    return /universal/i.test(name)
      ? ['darwin-x86_64', 'darwin-aarch64']
      : [`darwin-${architecture(name)}`];
  }
  return [];
};

const platforms = {};
for (const { artifactPath, signaturePath } of signedArtifacts) {
  for (const target of targets(artifactPath)) {
    if (platforms[target]) continue;
    platforms[target] = {
      signature: fs.readFileSync(signaturePath, 'utf8').trim(),
      url: `${downloadBase}${encodeURIComponent(path.basename(artifactPath))}`,
    };
  }
}

if (Object.keys(platforms).length === 0) {
  throw new Error(`No signed Tauri updater artifacts found in ${artifactRoot}`);
}

const manifest = {
  version: packageJson.version,
  notes: process.env.MINEBENCH_UPDATE_NOTES || `MineBench Client v${packageJson.version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updater manifest written to ${outputPath}`);
