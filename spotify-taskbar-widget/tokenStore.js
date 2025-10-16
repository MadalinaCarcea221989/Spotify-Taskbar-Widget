import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import CryptoJS from 'crypto-js';

// Place tokens in a user-writable location (APPDATA on Windows or home dir fallback).
const appDataBase = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const TOKEN_FILE = path.join(appDataBase, 'Spotify-Taskbar-Widget', 'tokens.json');

// WARNING: For real security, use a user-provided password or OS keychain. This is a static key for demo/dev only.
const ENCRYPTION_KEY = 'spotify-widget-demo-key-2025';

/**
 * Saves the Spotify API tokens to a local file.
 * @param {object} tokens - The token object received from Spotify.
 * @returns {Promise<void>}
 */
export async function saveTokens(tokens) {
  try {
    const plaintext = JSON.stringify(tokens);
    const ciphertext = CryptoJS.AES.encrypt(plaintext, ENCRYPTION_KEY).toString();
    await fs.writeFile(TOKEN_FILE, ciphertext);
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

/**
 * Loads the Spotify API tokens from the local file.
 * @returns {Promise<object|null>} The stored token object, or null if not found or an error occurs.
 */
export async function loadTokens() {
  try {
    const ciphertext = await fs.readFile(TOKEN_FILE, 'utf-8');
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const plaintext = bytes.toString(CryptoJS.enc.Utf8);
    if (!plaintext) throw new Error('Failed to decrypt tokens.');
    return JSON.parse(plaintext);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, which is a normal case on first run.
      return null;
    }
    console.error('Error loading tokens:', error);
    return null;
  }
}

/**
 * Deletes the local token file.
 * @returns {Promise<void>}
 */
export async function clearTokens() {
  try {
    await fs.unlink(TOKEN_FILE);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, nothing to clear.
      return;
    }
    console.error('Error clearing tokens:', error);
  }
}