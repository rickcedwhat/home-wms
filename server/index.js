/**
 * RF-SMART Prototype - Main Server Entry Point
 * 
 * Runs the Node.js middleware layer and serves the Knockout.js Handheld Scanner SPA.
 * Binds to 0.0.0.0 so phones on the same WiFi network can connect via LAN IP.
 * Listens on port 7370.
 */

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import scannerRouter from './routes/scanner.js';
import ideRouter from './routes/ide.js';
import { getDatabase } from './netsuite-mock/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7370;

// Initialize mock NetSuite SQLite database (file-backed so items persist between restarts)
getDatabase(false);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

// Printable bin label sheet
app.get('/print-bins', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'print-bins.html'));
});

// Dedicated Mobile Scanner for phones (simplified, camera-focused UI)
app.get(['/mobile', '/scan'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mobile.html'));
});

// Explicit Desktop Simulation route
app.get('/desktop', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Serve uploaded item images
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Root route: auto-direct mobile browsers to /mobile unless requested ?desktop=1
app.get('/', (req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
  if (isMobile && !req.query.desktop) {
    return res.redirect('/mobile');
  }
  next();
});

// Serve Frontend SPA static assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Detect local network IP for phone access
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Start Express Server - bind to 0.0.0.0 so phones on the same WiFi can reach it
const server = app.listen(PORT, '0.0.0.0', () => {
  const lanIP = getLanIP();
  console.log('================================================================');
  console.log(` RF-SMART Prototype running on port ${PORT}`);
  console.log(` Desktop:       http://localhost:${PORT}`);
  console.log(` 📱 Phone HTTP:  http://${lanIP}:${PORT}     ← open on your phone`);
  console.log(` 🔒 Phone HTTPS: https://${lanIP}:7373    ← live camera WebRTC`);
  console.log(` Code Studio:   http://localhost:${PORT}/code`);
  console.log('================================================================');
});

// Optional HTTPS server on port 7373 for browsers requiring secure context for getUserMedia
import https from 'node:https';
import fs from 'node:fs';

const HTTPS_PORT = 7373;
let httpsServer = null;

try {
  const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');
  const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const creds = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    httpsServer = https.createServer(creds, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      // Running HTTPS for WebRTC
    });
  }
} catch (e) {
  console.warn('[HTTPS] Skipped HTTPS server:', e.message);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down RF-SMART Prototype cleanly...');
  server.close(() => {
    if (httpsServer) httpsServer.close();
    process.exit(0);
  });
});
