import { promises as fs } from 'fs';
import path from 'path';

const TOKEN_FILE = 'tokens.json';

/**
 * Saves the Spotify API tokens to a local file.
 * @param {object} tokens - The token object received from Spotify.
 * @returns {Promise<void>}
 */
export async function saveTokens(tokens) {
  try {
    await fs.writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2));
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
    const data = await fs.readFile(TOKEN_FILE, 'utf-8');
    return JSON.parse(data);
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