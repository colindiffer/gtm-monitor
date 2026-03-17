'use strict';

require('dotenv').config();
const config = require('../config.json');
const { loadContainersFromSheet } = require('./sheets-config');
const { getContainerChanges, getLatestPublishedVersion, getVersionsSince, getLatestVersionId } = require('./gtm-api');
const { detectChanges, updateState, getUnreviewedChanges, hoursAgo, loadState, saveVersionBaseline, getVersionBaseline } = require('./change-detector');
const { sendChangeAlert, sendEscalationAlert, sendNewVersionAlert } = require('./notifier');
const { getRecentGtmActivity, getActorsForContainer } = require('./admin-reports');

async function runChecks() {
  console.log(`[${new Date().toISOString()}] Running GTM change checks...`);

  // Fetch recent GTM activity upfront for user attribution
  const activityMap = await getRecentGtmActivity(config.escalateAfterHours);

  let containers = config.containers;
  if (config.googleSheetId) {
    console.log('  Loading containers from Google Sheet...');
    try {
      containers = await loadContainersFromSheet(config.googleSheetId);
      console.log(`  Found ${containers.length} active container(s) in sheet`);
    } catch (err) {
      console.error(`  [ERROR] Failed to load sheet — falling back to config.json: ${err.message}`);
    }
  }

  for (const container of containers) {
    const { accountId, containerId, name: containerName } = container;

    if (accountId.startsWith('REPLACE') || containerId.startsWith('REPLACE')) {
      console.warn(`[!] Container "${containerName}" has placeholder IDs — update config.json`);
      continue;
    }

    console.log(`  Checking container: ${containerName} (${container.publicId})`);

    let currentWorkspaces;
    try {
      currentWorkspaces = await getContainerChanges(accountId, containerId);
    } catch (err) {
      console.error(`  [ERROR] Failed to fetch GTM data for ${containerName}: ${err.message}`);
      continue;
    }

    const { isFirstRun, workspaces: changedWorkspaces } = detectChanges(containerId, currentWorkspaces);

    // First run — save baseline. Workspaces modified recently (within escalateAfterHours)
    // are flagged as unreviewed so they aren't silently skipped.
    if (isFirstRun) {
      const baseline = currentWorkspaces.map(ws => {
        const fingerprintMs = parseInt(ws.fingerprint, 10);
        const ageHours = isNaN(fingerprintMs) ? 999 : (Date.now() - fingerprintMs) / (1000 * 60 * 60);
        const isRecent = ageHours <= config.escalateAfterHours;
        const hasPendingChanges = ws.changes && ws.changes.length > 0;
        const needsReview = isRecent || hasPendingChanges;
        return {
          workspaceId: ws.workspaceId,
          workspaceName: ws.workspaceName,
          fingerprint: ws.fingerprint,
          changes: ws.changes,
          isNewWorkspace: false,
          firstSeenAt: new Date().toISOString(),
          reviewedAt: needsReview ? null : new Date().toISOString(),
          alertedAt: null,
          lastEscalatedAt: null
        };
      });
      updateState(containerId, baseline);
      const recentCount = baseline.filter(ws => !ws.reviewedAt).length;
      if (recentCount > 0) {
        console.log(`  ! ${containerName} — baseline recorded, ${recentCount} recently modified workspace(s) flagged for review`);
      } else {
        console.log(`  ✓ ${containerName} — baseline recorded (${baseline.length} workspace(s))`);
      }
      continue;
    }

    const updatedState = [];

    for (const ws of changedWorkspaces) {
      const isNew = !ws.alertedAt;
      const ageHours = hoursAgo(ws.firstSeenAt);
      const hoursSinceEscalation = hoursAgo(ws.lastEscalatedAt);
      const reviewed = !!ws.reviewedAt;

      if (reviewed) {
        updatedState.push(ws);
        continue;
      }

      // Send initial alert for new changes
      if (isNew) {
        console.log(`    🔔 New change detected in workspace: ${ws.workspaceName}`);

        // If no pending changes, this is likely a post-publish reset — fetch what was published
        let publishedVersion = null;
        if (!ws.changes || ws.changes.length === 0) {
          try {
            publishedVersion = await getLatestPublishedVersion(accountId, containerId);
          } catch (err) {
            console.error(`    [WARN] Could not fetch published version: ${err.message}`);
          }
        }

        const actors = getActorsForContainer(activityMap, containerId);

        try {
          await sendChangeAlert({
            containerName,
            workspaceName: ws.workspaceName,
            workspaceId: ws.workspaceId,
            containerId,
            changes: ws.changes,
            firstSeenAt: ws.firstSeenAt,
            isNewWorkspace: ws.isNewWorkspace,
            publishedVersion,
            actors
          });
          ws.alertedAt = new Date().toISOString();
        } catch (err) {
          console.error(`    [ERROR] Failed to send alert: ${err.message}`);
        }
      }

      // Escalate if over 48h unreviewed and not recently escalated
      const shouldEscalate = ageHours >= config.escalateAfterHours &&
        (hoursSinceEscalation === 0 || hoursSinceEscalation >= config.reescalateEveryHours);

      if (shouldEscalate) {
        console.log(`    ⚠️  Escalating — ${ageHours.toFixed(1)}h unreviewed`);
        try {
          await sendEscalationAlert({
            containerName,
            workspaceName: ws.workspaceName,
            workspaceId: ws.workspaceId,
            containerId,
            changes: ws.changes,
            hoursUnreviewed: ageHours
          });
          ws.lastEscalatedAt = new Date().toISOString();
        } catch (err) {
          console.error(`    [ERROR] Failed to send escalation: ${err.message}`);
        }
      }

      updatedState.push(ws);
    }

    updateState(containerId, updatedState);

    const unreviewed = getUnreviewedChanges(containerId);
    if (unreviewed.length === 0) {
      console.log(`  ✓ ${containerName} — no unreviewed changes`);
    } else {
      console.log(`  ! ${containerName} — ${unreviewed.length} workspace(s) with unreviewed changes`);
    }

    // Check for new versions created since last check
    try {
      const latestVersionId = await getLatestVersionId(accountId, containerId);
      const baseline = getVersionBaseline(containerId);

      if (baseline === null) {
        // First run — record current version ID as baseline
        saveVersionBaseline(containerId, latestVersionId);
      } else if (latestVersionId > baseline) {
        const newVersions = await getVersionsSince(accountId, containerId, baseline);
        if (newVersions.length > 0) {
          console.log(`  📋 ${containerName} — ${newVersions.length} new version(s) since last check`);
          await sendNewVersionAlert({ containerName, versions: newVersions });
          saveVersionBaseline(containerId, latestVersionId);
        }
      }
    } catch (err) {
      console.error(`  [ERROR] Failed to check version history for ${containerName}: ${err.message}`);
    }
  }

  console.log('[Done]');
}

runChecks().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
