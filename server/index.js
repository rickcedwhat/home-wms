/**
 * RF-SMART Prototype - Main Server Entry Point
 * 
 * Runs the Node.js middleware layer and serves the Knockout.js Handheld Scanner SPA.
 * Listens on port 7370.
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import scannerRouter from './routes/scanner.js';
import ideRouter from './routes/ide.js';
import { getDatabase } from './netsuite-mock/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7370;

// Initialize mock NetSuite SQLite database
getDatabase(true);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging for warehouse scan telemetry
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      const duration = Date.now() - start;
      console.log(`[MIDDLEWARE] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount APIs
app.use('/api/scanner', scannerRouter);
app.use('/api/ide', ideRouter);

// Dedicated route for In-Browser IDE / Code Studio
app.get(['/code', '/ide'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'code.html'));
});

// Serve Frontend SPA static assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Express Server
const server = app.listen(PORT, () => {
  console.log('================================================================');
  console.log(` RF-SMART Warehouse Prototype is running on port ${PORT}`);
  console.log(` Handheld Scanner UI: http://localhost:${PORT}`);
  console.log(` Middleware API:     http://localhost:${PORT}/api/scanner/lookup`);
  console.log('================================================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down RF-SMART Prototype cleanly...');
  server.close(() => {
    process.exit(0);
  });
});
