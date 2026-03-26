#!/usr/bin/env node
'use strict';

// Usage: node review.js <containerId> <workspaceId>
// Or:    node review.js --list

require('dotenv').config();
const { markReviewed, getAllContainerStates, hoursAgo } = require('./src/change-detector');
const config = require('./config.json');
const { loadContainersFromSheet } = require('./src/sheets-config');

const args = process.argv.slice(2);

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});

async function main() {
  if (args[0] === '--list' || args.length === 0) {
    await listPendingReviews();
    return;
  }

  if (args.length === 2) {
    const [containerId, workspaceId] = args;
    const success = markReviewed(containerId, workspaceId);
    if (success) {
      console.log(`✓ Marked as reviewed: container=${containerId}, workspace=${workspaceId}`);
    } else {
      console.log(`No unreviewed entry found for container=${containerId}, workspace=${workspaceId}`);
      console.log('Run "node review.js --list" to see pending reviews');
    }
    return;
  }

  console.log('Usage:');
  console.log('  node review.js --list                         # list all unreviewed changes');
  console.log('  node review.js <containerId> <workspaceId>    # mark as reviewed');
}

async function getContainers() {
  if (config.googleSheetId) {
    try {
      return await loadContainersFromSheet(config.googleSheetId);
    } catch (err) {
      console.warn(`[WARN] Failed to load containers from Google Sheet, falling back to config.json: ${err.message}`);
    }
  }

  return config.containers || [];
}

async function listPendingReviews() {
  const allStates = getAllContainerStates();
  const containers = await getContainers();
  const containerMap = new Map(containers.map(container => [container.containerId, container]));
  const stateContainerIds = Object.keys(allStates).filter(key => !key.startsWith('_'));
  const containerIds = [...new Set([...containerMap.keys(), ...stateContainerIds])];
  let found = false;

  for (const containerId of containerIds) {
    const container = containerMap.get(containerId);
    const name = container ? container.name : `Container ${containerId}`;
    const unreviewed = Object.values(allStates[containerId] || {})
      .filter(ws => !ws.reviewedAt && ws.changes && ws.changes.length > 0);

    if (unreviewed.length === 0) continue;

    found = true;
    console.log(`\n${name} (${containerId})`);
    console.log('─'.repeat(50));

    for (const ws of unreviewed) {
      const age = hoursAgo(ws.firstSeenAt);
      const overdue = age >= 24;
      const flag = overdue ? '⚠️ OVERDUE' : '🔔 Pending';

      console.log(`  ${flag} — ${ws.workspaceName} (workspace ${ws.workspaceId})`);
      console.log(`    First seen: ${new Date(ws.firstSeenAt).toLocaleString('en-GB')} (${age.toFixed(1)}h ago)`);
      console.log(`    Changes: ${ws.changes.length} item(s)`);
      ws.changes.forEach(c => {
        console.log(`      - [${c.changeType}] ${c.entityType}: ${c.name}`);
      });
      if (ws.aiSummary) {
        console.log(`    AI Risk: ${ws.aiSummary.riskLevel}`);
        console.log(`    Summary: ${ws.aiSummary.summary}`);
      }
      console.log(`    Mark reviewed: node review.js ${containerId} ${ws.workspaceId}`);
    }
  }

  if (!found) {
    console.log('✓ No unreviewed GTM changes');
  }
}
