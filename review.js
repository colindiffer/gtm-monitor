#!/usr/bin/env node
'use strict';

// Usage: node review.js <containerId> <workspaceId>
// Or:    node review.js --list

const { markReviewed, getAllContainerStates, getUnreviewedChanges, hoursAgo } = require('./src/change-detector');
const config = require('./config.json');

const args = process.argv.slice(2);

if (args[0] === '--list' || args.length === 0) {
  listPendingReviews();
} else if (args.length === 2) {
  const [containerId, workspaceId] = args;
  const success = markReviewed(containerId, workspaceId);
  if (success) {
    console.log(`✓ Marked as reviewed: container=${containerId}, workspace=${workspaceId}`);
  } else {
    console.log(`No unreviewed entry found for container=${containerId}, workspace=${workspaceId}`);
    console.log('Run "node review.js --list" to see pending reviews');
  }
} else {
  console.log('Usage:');
  console.log('  node review.js --list                         # list all unreviewed changes');
  console.log('  node review.js <containerId> <workspaceId>    # mark as reviewed');
}

function listPendingReviews() {
  const allStates = getAllContainerStates();
  let found = false;

  for (const container of config.containers) {
    const { containerId, name } = container;
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
