'use strict';

const { google } = require('googleapis');
require('dotenv').config();

// Expected sheet columns (row 1 = headers, data from row 2):
// A: Name          e.g. "SportsShoes Web"
// B: Account ID    e.g. "123456789"
// C: Container ID  e.g. "987654321"
// D: Public ID     e.g. "GTM-XXXXXX"
// E: Revenue Critical  e.g. "yes" or "no"
// F: Active        e.g. "yes" or "no"

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

async function loadContainersFromSheet(sheetId) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A2:F1000'
  });

  const rows = res.data.values || [];
  const containers = [];

  for (const row of rows) {
    const [name, accountId, containerId, publicId, revenueStr, activeStr] = row;

    if (!name || !accountId || !containerId) continue;
    if (!/^\d+$/.test(accountId.trim()) || !/^\d+$/.test(containerId.trim())) continue;

    const active = !activeStr || activeStr.toLowerCase() !== 'no';
    if (!active) continue;

    containers.push({
      name: name.trim(),
      accountId: accountId.trim(),
      containerId: containerId.trim(),
      publicId: (publicId || '').trim(),
      revenueImpact: (revenueStr || '').toLowerCase() === 'yes'
    });
  }

  return containers;
}

module.exports = { loadContainersFromSheet };
