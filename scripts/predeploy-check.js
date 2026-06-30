#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeReleaseScope } = require('./release-scope');

const root = path.join(__dirname, '..');
const expectedProjectId = 'prj_SEO8zTTItfowDPOdsS2FF8g9qCj8';
const expectedProjectName = 'fifa-wc-2026';
const expectedAuthorEmail = process.env.VERCEL_DEPLOY_AUTHOR_EMAIL || 'david@medina.contact';

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error('Deploy preflight failed:', message);
  process.exit(1);
}

const branch = git('branch', '--show-current');
if (branch !== 'main') fail(`expected main branch, found ${branch || 'detached HEAD'}`);

const authorEmail = git('log', '-1', '--format=%ae');
if (authorEmail !== expectedAuthorEmail) {
  fail(`HEAD author ${authorEmail} is not the verified Hobby owner ${expectedAuthorEmail}`);
}

const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
const unexpectedDirty = dirty.filter(line => line.slice(3) !== 'service-worker.js');
if (unexpectedDirty.length) fail(`unexpected working-tree changes: ${unexpectedDirty.join(', ')}`);

const candidates = ['repo.json', 'project.json'];
const linked = candidates.map(file => path.join(root, '.vercel', file)).find(fs.existsSync);
if (!linked) fail('missing .vercel/repo.json or .vercel/project.json');

const config = JSON.parse(fs.readFileSync(linked, 'utf8'));
const projects = config.projects || [{ id: config.projectId, name: expectedProjectName }];
const project = projects.find(item => item.id === expectedProjectId);
if (!project || project.name !== expectedProjectName) {
  fail(`worktree is not linked to ${expectedProjectName} (${expectedProjectId})`);
}

console.log(`Deploy preflight passed: ${branch}, ${authorEmail}, ${project.name}`);
writeReleaseScope();
