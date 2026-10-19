#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Static server for local testing, with HTTP range requests like GitHub Pages.
//
//   node scripts/serve.mjs [dir] [port]          (--no-ranges answers 200 to range requests)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const noRanges = args.includes('--no-ranges');
const [dir = 'dist', port = '8080'] = args.filter((a) => !a.startsWith('--'));
const root = path.resolve(dir);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const range = !noRanges && req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': noRanges ? 'none' : 'bytes' });
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(port), () => console.log(`serving ${root} on http://localhost:${port}/${noRanges ? ' (no ranges)' : ''}`));
