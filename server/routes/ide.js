/**
 * RF-SMART Code Studio / In-Browser IDE API
 * 
 * Safely provides file tree listing and file contents for the code viewer.
 */

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const router = express.Router();

// Allowlist of project files with architectural metadata
const PROJECT_FILES = [
  // 1. RF-SMART Node.js Middleware
  {
    path: 'server/index.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'index.js',
    language: 'javascript',
    description: 'Express server entry point on port 7370, request logging, and route mounting.'
  },
  {
    path: 'server/routes/scanner.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'scanner.js',
    language: 'javascript',
    description: 'REST API routes for barcode lookup, bin transfers, cache invalidation, and ERP error normalization.'
  },
  {
    path: 'server/services/barcodeParser.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'barcodeParser.js',
    language: 'javascript',
    description: 'Industrial barcode parser supporting SKUs, UPC-A, Bins, and composite GS1-128 Application Identifiers.'
  },
  {
    path: 'server/services/cache.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'cache.js',
    language: 'javascript',
    description: 'In-memory lookup buffer (<5ms response time) protecting NetSuite from 429 concurrency throttles.'
  },
  {
    path: 'server/services/concurrencyManager.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'concurrencyManager.js',
    language: 'javascript',
    description: 'Keyed asynchronous mutex locking to prevent race conditions during simultaneous warehouse scans.'
  },
  {
    path: 'server/services/auth.js',
    category: 'Node.js Middleware',
    layer: 'MIDDLEWARE',
    name: 'auth.js',
    language: 'javascript',
    description: 'NetSuite Token-Based Authentication (TBA) implementing RFC 5849 OAuth 1.0a HMAC-SHA256.'
  },

  // 2. Mock NetSuite SuiteScript 2.1
  {
    path: 'server/netsuite-mock/restlet.js',
    category: 'Mock NetSuite SuiteScript 2.1',
    layer: 'SUITESCRIPT',
    name: 'restlet.js',
    language: 'javascript',
    description: 'Simulated SuiteScript 2.1 RESTlet AMD module (define([N/record, N/search])) with simulated ERP latency.'
  },
  {
    path: 'server/netsuite-mock/nRecord.js',
    category: 'Mock NetSuite SuiteScript 2.1',
    layer: 'SUITESCRIPT',
    name: 'nRecord.js',
    language: 'javascript',
    description: 'SuiteScript N/record implementation with dynamic sublist manipulation and atomic SQLite ledger updates.'
  },
  {
    path: 'server/netsuite-mock/nSearch.js',
    category: 'Mock NetSuite SuiteScript 2.1',
    layer: 'SUITESCRIPT',
    name: 'nSearch.js',
    language: 'javascript',
    description: 'SuiteScript N/search implementation querying items, bins, and balances with getRange().'
  },
  {
    path: 'server/netsuite-mock/db.js',
    category: 'Mock NetSuite SuiteScript 2.1',
    layer: 'SUITESCRIPT',
    name: 'db.js',
    language: 'javascript',
    description: 'Relational database schema and warehouse seed data powered by Node.js native SQLite (node:sqlite).'
  },

  // 3. Handheld Scanner Frontend
  {
    path: 'public/index.html',
    category: 'Handheld Scanner (Knockout)',
    layer: 'FRONTEND',
    name: 'index.html',
    language: 'markup',
    description: 'Zebra TC52x rugged handheld scanner layout with Knockout.js MVVM data-bind attributes.'
  },
  {
    path: 'public/app.js',
    category: 'Handheld Scanner (Knockout)',
    layer: 'FRONTEND',
    name: 'app.js',
    language: 'javascript',
    description: 'Knockout.js ViewModel (ko.observable, ko.computed) and Web Audio API synthesizer for barcode chimes.'
  },
  {
    path: 'public/styles.css',
    category: 'Handheld Scanner (Knockout)',
    layer: 'FRONTEND',
    name: 'styles.css',
    language: 'css',
    description: 'Industrial warehouse scanner styling, tactile buttons, high-contrast dark theme, and visual flash effects.'
  },

  // 4. Automated Tests
  {
    path: 'test/scanner.test.js',
    category: 'Automated Tests',
    layer: 'TESTS',
    name: 'scanner.test.js',
    language: 'javascript',
    description: '16 automated backend tests verifying parser, TBA auth, cache, concurrency mutex, and SuiteScript engine.'
  },

  // 5. Documentation
  {
    path: 'README.md',
    category: 'Documentation',
    layer: 'DOCS',
    name: 'README.md',
    language: 'markdown',
    description: 'Architecture blueprint, interview talking points, and setup instructions.'
  },
  {
    path: 'HANDOFF.md',
    category: 'Documentation',
    layer: 'DOCS',
    name: 'HANDOFF.md',
    language: 'markdown',
    description: 'Original architecture requirements and technology stack specification.'
  }
];

/**
 * GET /api/ide/files
 * Returns the catalog of project files.
 */
router.get('/files', (req, res) => {
  res.json({
    success: true,
    files: PROJECT_FILES
  });
});

/**
 * GET /api/ide/file?path=...
 * Returns the source code for a requested project file.
 */
router.get('/file', async (req, res) => {
  const reqPath = req.query.path;
  if (!reqPath) {
    return res.status(400).json({ success: false, error: 'Missing "path" query parameter' });
  }

  // Security check: ensure path is in allowlist
  const fileMeta = PROJECT_FILES.find(f => f.path === reqPath);
  if (!fileMeta) {
    return res.status(403).json({ success: false, error: 'Access denied: File not in allowed project tree.' });
  }

  try {
    const fullPath = path.resolve(PROJECT_ROOT, reqPath);
    // Double-check path traversal
    if (!fullPath.startsWith(PROJECT_ROOT)) {
      return res.status(403).json({ success: false, error: 'Invalid file path' });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    res.json({
      success: true,
      file: {
        ...fileMeta,
        content,
        lineCount: lines.length,
        byteSize: Buffer.byteLength(content, 'utf-8')
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: `Failed to read file: ${err.message}`
    });
  }
});

export default router;
