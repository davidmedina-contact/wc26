#!/usr/bin/env node
// Stamps the service worker with the current timestamp so that every deploy
// produces a byte-different SW file, triggering the browser's update check.
const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'service-worker.js');
let content = fs.readFileSync(swPath, 'utf8');

const ts = new Date().toISOString();
content = content.replace(
  /var BUILD_TS = '[^']*';/,
  "var BUILD_TS = '" + ts + "';"
);

fs.writeFileSync(swPath, content, 'utf8');
console.log('Stamped service-worker.js with BUILD_TS =', ts);
