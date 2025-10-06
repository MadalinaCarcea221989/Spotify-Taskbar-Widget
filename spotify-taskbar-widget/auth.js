import { createServer } from 'http';
import express from 'express';
import open from 'open';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { saveTokens, loadTokens } from './tokenStore.js';

let server;

// --- PKCE Helper Functions ---

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
function generateRandomString(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Hashes the input string using SHA256.
 * @param {string} buffer
 * @returns {Buffer}
 */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

/**
 * Base64 URL-encodes the input buffer.
 * @param {Buffer} buffer
 * @returns {string}
 */
function base64urlencode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// --- Main Authentication Flow ---

/**
 * Starts the authentication process by opening a browser window and starting a local server.
 * @param {object} config - The application configuration.
 * @param {Function} onAuthSuccess - Callback function to execute upon successful authentication.
 */
export function startAuthFlow(config, onAuthSuccess) {
  const { client_id, redirect_uri, scopes, port } = config;

  const code_verifier = generateRandomString(128);
  const code_challenge = base64urlencode(sha256(code_verifier));

  const app = express();
  server = createServer(app);

  app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    if (!code) {
      res.status(400).send("<html><body><h1>Error</h1><p>Authorization code not found.</p></body></html>");
      return;
    }

    const params = new URLSearchParams();
    params.append('client_id', client_id);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirect_uri);
    params.append('code_verifier', code_verifier);

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch token: ${response.statusText} - ${errorBody}`);
      }

      const tokens = await response.json();
      tokens.obtained_at = Math.floor(Date.now() / 1000); // Add timestamp in seconds

      await saveTokens(tokens);

      res.send("<html><body><h1>Success!</h1><p>You are authenticated. You can close this window now.</p><script>window.close();</script></body></html>");

      onAuthSuccess();

    } catch (error) {
      console.error('Error exchanging code for token:', error);
      res.status(500).send("<html><body><h1>Error</h1><p>Failed to get authentication token.</p></body></html>");
    } finally {
      if (server) {
        server.close();
        server = null;
      }
    }
  });

  server.listen(port, () => {
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: client_id,
      scope: scopes,
      redirect_uri: redirect_uri,
      code_challenge_method: 'S256',
      code_challenge: code_challenge,
    }).toString();

    console.log(`Opening browser for authentication: ${authUrl.toString()}`);
    open(authUrl.toString());
  });
}

/**
 * Refreshes the Spotify access token using the stored refresh token.
 * @param {string} refreshToken - The refresh token.
 * @param {object} config - The application configuration.
 * @returns {Promise<object|null>} The new token object, or null if refresh fails.
 */
export async function refreshTokens(refreshToken, config) {
  const { client_id } = config;

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', client_id);

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to refresh token: ${response.statusText} - ${errorBody}`);
    }

    const newTokens = await response.json();
    newTokens.obtained_at = Math.floor(Date.now() / 1000);

    // Spotify doesn't always send a new refresh token. Preserve the old one if not present.
    if (!newTokens.refresh_token) {
      newTokens.refresh_token = refreshToken;
    }

    await saveTokens(newTokens);
    console.log('Tokens refreshed successfully.');
    return newTokens;

  } catch (error) {
    console.error('Error refreshing tokens:', error);
    // If refresh fails, the user might need to re-authenticate.
    return null;
  }
}