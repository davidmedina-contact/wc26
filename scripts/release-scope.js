#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, '.vercel', 'release-scope.json');

function requiresLiveApiValidation(file) {
  return file === 'data.json'
    || file === 'vercel.json'
    || file.startsWith('api/')
    || file.startsWith('data/');
}

function classifyRelease(files) {
  const liveApiFiles = files.filter(requiresLiveApiValidation);
  return {
    scope: liveApiFiles.length ? 'full' : 'shell',
    files,
    liveApiFiles,
  };
}

function changedFiles(baseRef) {
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

function writeReleaseScope() {
  const baseRef = process.env.DEPLOY_BASE_REF || 'HEAD^';
  const result = classifyRelease(changedFiles(baseRef));
  const manifest = {
    ...result,
    baseRef,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Release verification scope: ${manifest.scope}${manifest.liveApiFiles.length ? ` (${manifest.liveApiFiles.join(', ')})` : ' (presentation only)'}`);
  return manifest;
}

if (require.main === module) writeReleaseScope();

module.exports = { classifyRelease, requiresLiveApiValidation, writeReleaseScope };
