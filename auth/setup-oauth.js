#!/usr/bin/env node
'use strict';

// Run this ONCE to get your Google refresh token.
// It opens a browser for OAuth consent, then stores the refresh token in your .env file.

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/admin.reports.audit.readonly'
];
const ENV_FILE = path.join(__dirname, '..', '.env');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/oauth/callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('\n=== GTM OAuth Setup ===\n');
console.log('1. Opening auth URL in your browser (or copy it manually):');
console.log('\n', authUrl, '\n');

// Try to open browser
const { exec } = require('child_process');
exec(`start "" "${authUrl}"`);

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('No auth code received. Please try again.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      res.end('No refresh token received. Make sure you revoked access first and try again.');
      console.error('[!] No refresh token. Go to https://myaccount.google.com/permissions and revoke access, then retry.');
      server.close();
      return;
    }

    // Update .env file
    let envContent = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
      envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${refreshToken}`);
    } else {
      envContent += `\nGOOGLE_REFRESH_TOKEN=${refreshToken}`;
    }
    fs.writeFileSync(ENV_FILE, envContent);

    console.log('\n✓ Refresh token saved to .env');
    console.log('✓ OAuth setup complete! You can now run: node src/check.js\n');

    res.end('<html><body><h2>✓ Auth complete! You can close this tab.</h2></body></html>');
    server.close();
  } catch (err) {
    console.error('Error getting tokens:', err.message);
    res.end('Error: ' + err.message);
    server.close();
  }
});

server.listen(3000, () => {
  console.log('2. Waiting for OAuth callback on http://localhost:3000...\n');
});
