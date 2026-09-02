import { access, cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const platform = process.argv[2];
const expectedExtensions = {
  windows: ['.exe'],
  linux: ['.AppImage', '.deb', '.rpm'],
};

if (!expectedExtensions[platform]) {
  throw new Error('Usage: node scripts/collect-release-artifacts.mjs <windows|linux>');
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const version = String(packageJson.version).replace(/^v/i, '');
const targetDir = path.resolve(process.env.CARGO_TARGET_DIR || 'src-tauri/target');
const outputDir = path.resolve('release-artifacts');

const findBundleFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? findBundleFiles(entryPath) : [entryPath];
  }));

  return files.flat();
};

const outputNames = {
  '.AppImage': `MineBench.Client_${version}_amd64.AppImage`,
  '.deb': `MineBench.Client_${version}_amd64.deb`,
  '.dmg': `MineBench.Client_${version}_universal.dmg`,
  '.exe': `MineBench.Client_${version}_x64-setup.exe`,
  '.msi': `MineBench.Client_${version}_x64_en-US.msi`,
  '.rpm': `MineBench.Client-${version}-1.x86_64.rpm`,
};

const bundleFiles = (await findBundleFiles(targetDir)).filter((file) =>
  file.split(path.sep).includes('bundle')
);

await mkdir(outputDir, { recursive: true });

for (const extension of expectedExtensions[platform]) {
  const source = bundleFiles.find((file) => file.endsWith(extension));
  if (!source) {
    throw new Error(`Tauri did not produce a ${extension} bundle for ${platform}`);
  }

  const destination = path.join(outputDir, outputNames[extension]);
  await cp(source, destination);
  console.log(`${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), destination)}`);

  if (extension === '.exe' || extension === '.AppImage') {
    const signatureSource = `${source}.sig`;
    await access(signatureSource);
    const signatureDestination = `${destination}.sig`;
    await cp(signatureSource, signatureDestination);
    console.log(`${path.relative(process.cwd(), signatureSource)} -> ${path.relative(process.cwd(), signatureDestination)}`);
  }
}
