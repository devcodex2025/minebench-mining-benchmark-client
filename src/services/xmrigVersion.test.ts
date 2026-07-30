import assert from 'node:assert/strict';
import {
  getInitialXmrigVersionInfo,
  getXmrigVersionPresentation,
} from './xmrigVersion.ts';

const initial = getXmrigVersionPresentation(getInitialXmrigVersionInfo());
assert.equal(initial.currentLabel, 'Detecting...');
assert.equal(initial.showUpdateAction, false);

const current = getXmrigVersionPresentation({
  currentVersion: '6.26.0',
  latestVersion: '6.26.0',
  updateAvailable: false,
  platform: 'windows/x86_64',
  releaseUrl: 'https://github.com/xmrig/xmrig/releases/latest',
});
assert.equal(current.currentLabel, 'v6.26.0');
assert.equal(current.statusLabel, 'Latest installed');
assert.equal(current.showUpdateAction, false);

const outdated = getXmrigVersionPresentation({
  currentVersion: '6.26.0',
  latestVersion: '6.27.0',
  updateAvailable: true,
  platform: 'linux/x86_64',
  releaseUrl: 'https://github.com/xmrig/xmrig/releases/latest',
});
assert.equal(outdated.statusLabel, 'v6.27.0 available');
assert.equal(outdated.showUpdateAction, true);
assert.equal(outdated.updateActionLabel, 'Get v6.27.0');

console.log('XMRig Settings version presentation tests passed');
