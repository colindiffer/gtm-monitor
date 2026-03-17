'use strict';

const https = require('https');
const http = require('http');
require('dotenv').config();

function postToSlack(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(webhookUrl);
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatChangeList(changes) {
  const typeEmoji = { added: '➕', created: '➕', modified: '✏️', updated: '✏️', deleted: '🗑️' };
  return changes.map(c => {
    const emoji = typeEmoji[c.changeType.toLowerCase()] || '•';
    const label = c.entityType.charAt(0).toUpperCase() + c.entityType.slice(1);
    return `${emoji} ${label}: *${c.name}*`;
  }).join('\n');
}

async function sendChangeAlert({ containerName, workspaceName, workspaceId, containerId, changes, firstSeenAt, isNewWorkspace, publishedVersion, actors }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.includes('YOUR/WEBHOOK')) {
    console.log('[Notifier] No Slack webhook configured — logging to console only.');
    return;
  }

  const firstSeenFormatted = new Date(firstSeenAt).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const reviewCommand = `node review.js ${containerId} ${workspaceId}`;

  const isPostPublish = (!changes || changes.length === 0) && publishedVersion;
  const hasPendingChanges = changes && changes.length > 0;

  const title = isPostPublish
    ? `📢 Published to live — ${containerName}`
    : `🔔 Unpublished changes — ${containerName}`;

  const statusBadge = isPostPublish
    ? `*Status: 🟢 LIVE*`
    : `*Status: 🟠 NOT YET LIVE*`;

  let changeText;
  if (isPostPublish) {
    const versionLabel = publishedVersion.versionName || `Version ${publishedVersion.versionId}`;
    const diffList = publishedVersion.diff && publishedVersion.diff.length > 0
      ? formatChangeList(publishedVersion.diff)
      : '_No differences detected from previous version_';
    changeText = `*What changed (${versionLabel}):*\n${publishedVersion.description ? `_${publishedVersion.description}_\n` : ''}${diffList}`;
  } else if (hasPendingChanges) {
    changeText = `*Pending changes (not yet published):*\n${formatChangeList(changes)}`;
  } else {
    changeText = `*Note:* New workspace with no pending changes. Review before publishing.`;
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Workspace:*\n${workspaceName}` },
        { type: 'mrkdwn', text: `*First Seen:*\n${firstSeenFormatted}` },
        ...(actors && actors.length > 0 ? [{ type: 'mrkdwn', text: `*Changed by:*\n${actors.join(', ')}` }] : []),
        { type: 'mrkdwn', text: statusBadge }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: changeText }
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Review in GTM, then mark done: \`${reviewCommand}\``
      }]
    }
  ];

  await postToSlack(webhookUrl, { blocks });
  console.log(`[Notifier] Alert sent for ${containerName} / ${workspaceName}`);
}

async function sendEscalationAlert({ containerName, workspaceName, workspaceId, containerId, changes, hoursUnreviewed }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.includes('YOUR/WEBHOOK')) {
    console.log(`[Notifier] ESCALATION (${hoursUnreviewed.toFixed(1)}h unreviewed): ${containerName} / ${workspaceName}`);
    return;
  }

  const reviewCommand = `node review.js ${containerId} ${workspaceId}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `⚠️ Unreviewed GTM Changes — ${hoursUnreviewed.toFixed(0)}h old` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Container:*\n${containerName}` },
        { type: 'mrkdwn', text: `*Workspace:*\n${workspaceName}` },
        { type: 'mrkdwn', text: `*Hours Unreviewed:*\n${hoursUnreviewed.toFixed(1)}h` },
        { type: 'mrkdwn', text: `*Status:*\n🟠 NOT YET LIVE` }
      ]
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Changes still pending review:*\n${formatChangeList(changes)}` }
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Review in GTM, then mark done: \`${reviewCommand}\``
      }]
    }
  ];

  await postToSlack(webhookUrl, { blocks });
  console.log(`[Notifier] Escalation sent for ${containerName} — ${hoursUnreviewed.toFixed(1)}h unreviewed`);
}

async function sendNewVersionAlert({ containerName, versions }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.includes('YOUR/WEBHOOK')) {
    console.log(`[Notifier] New version(s) in ${containerName}:`, versions);
    return;
  }

  const versionList = versions.map(v =>
    `• *${v.versionName}* (v${v.versionId})${v.description ? ` — ${v.description}` : ''}`
  ).join('\n');

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 New Version Saved — ${containerName}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `A new version has been created. Check GTM to confirm whether it has been published to live or is still a draft:` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: versionList }
    }
  ];

  await postToSlack(webhookUrl, { blocks });
  console.log(`[Notifier] New version alert sent for ${containerName}`);
}

module.exports = { sendChangeAlert, sendEscalationAlert, sendNewVersionAlert };
