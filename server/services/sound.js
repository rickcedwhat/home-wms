/**
 * Server-Side Audio Feedback Engine (macOS afplay + terminal bell)
 * 
 * Plays crisp physical audio chimes through the host machine speakers
 * whenever a barcode scan or warehouse transaction arrives from a mobile phone.
 */

import { exec } from 'node:child_process';

const SOUNDS = {
  scan: '/System/Library/Sounds/Ping.aiff',       // Item scanned
  location: '/System/Library/Sounds/Tink.aiff',   // Location / door sticker scanned
  transfer: '/System/Library/Sounds/Hero.aiff',   // Transfer or restock committed
  error: '/System/Library/Sounds/Basso.aiff'      // Unknown barcode / error
};

export function playServerSound(type = 'scan') {
  // 1. Ring standard terminal bell in the active console
  try {
    process.stdout.write('\x07');
  } catch (_) {}

  // 2. Play macOS native system audio if running on Mac
  if (process.platform === 'darwin') {
    const soundFile = SOUNDS[type] || SOUNDS.scan;
    exec(`afplay "${soundFile}"`, (err) => {
      // Fire-and-forget; ignore audio daemon errors
    });
  }
}
