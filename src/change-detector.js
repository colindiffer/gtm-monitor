'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'state', 'last-seen.json');

function getStateFile() {
  if (process.env.STATE_FILE) {
    return process.env.STATE_FILE;
  }

  const stateDir = process.env.STATE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (stateDir) {
    return path.join(stateDir, 'last-seen.json');
  }

  return DEFAULT_STATE_FILE;
}

function loadState() {
  const stateFile = getStateFile();
  if (!fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  const stateFile = getStateFile();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// Returns workspaces that need attention:
// - On first run for a container: record all as baseline, alert on nothing
// - On subsequent runs: alert if a workspace is brand new (wasn't seen before)
//   or if an existing workspace's fingerprint changed (it was modified)
function detectChanges(containerId, currentWorkspaces) {
  const state = loadState();
  const containerState = state[containerId];
  const isFirstRun = !containerState;
  const existing = containerState || {};
  const results = [];

  if (isFirstRun) {
    // No prior state — signal to caller to record baseline
    return { isFirstRun: true, workspaces: [] };
  }

  for (const ws of currentWorkspaces) {
    const key = ws.workspaceId;
    const prev = existing[key];

    const isNew = !prev;
    const fingerprintChanged = prev && prev.fingerprint !== ws.fingerprint;
    const alreadyTracked = prev && prev.fingerprint === ws.fingerprint;

    if (isNew || fingerprintChanged) {
      results.push({
        workspaceId: ws.workspaceId,
        workspaceName: ws.workspaceName,
        fingerprint: ws.fingerprint,
        changes: ws.changes,
        isNewWorkspace: isNew,
        firstSeenAt: new Date().toISOString(),
        reviewedAt: null,
        alertedAt: null,
        lastEscalatedAt: null
      });
    } else if (alreadyTracked && !prev.reviewedAt) {
      // Still unreviewed — carry forward for escalation checks
      results.push(prev);
    }
  }

  return { isFirstRun: false, workspaces: results };
}

function updateState(containerId, workspaceChanges) {
  const state = loadState();
  if (!state[containerId]) state[containerId] = {};

  for (const wc of workspaceChanges) {
    const existing = state[containerId][wc.workspaceId];

    state[containerId][wc.workspaceId] = {
      workspaceId: wc.workspaceId,
      workspaceName: wc.workspaceName,
      fingerprint: wc.fingerprint,
      changes: wc.changes,
      isNewWorkspace: wc.isNewWorkspace || (existing ? existing.isNewWorkspace : false),
      firstSeenAt: existing && existing.firstSeenAt ? existing.firstSeenAt : new Date().toISOString(),
      reviewedAt: wc.reviewedAt || (existing ? existing.reviewedAt : null),
      alertedAt: wc.alertedAt || (existing ? existing.alertedAt : null),
      lastEscalatedAt: wc.lastEscalatedAt || (existing ? existing.lastEscalatedAt : null)
    };
  }

  saveState(state);
}

function markReviewed(containerId, workspaceId) {
  const state = loadState();
  if (state[containerId] && state[containerId][workspaceId]) {
    state[containerId][workspaceId].reviewedAt = new Date().toISOString();
    saveState(state);
    return true;
  }
  return false;
}

function getUnreviewedChanges(containerId) {
  const state = loadState();
  const containerState = state[containerId] || {};
  return Object.values(containerState).filter(ws => !ws.reviewedAt);
}

function getAllContainerStates() {
  return loadState();
}

function hoursAgo(isoString) {
  if (!isoString) return 0;
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60);
}

function saveVersionBaseline(containerId, latestVersionId) {
  const state = loadState();
  if (!state._versionBaselines) state._versionBaselines = {};
  state._versionBaselines[containerId] = latestVersionId;
  saveState(state);
}

function getVersionBaseline(containerId) {
  const state = loadState();
  return (state._versionBaselines && state._versionBaselines[containerId]) || null;
}

module.exports = {
  detectChanges,
  updateState,
  markReviewed,
  getUnreviewedChanges,
  getAllContainerStates,
  hoursAgo,
  loadState,
  getStateFile,
  saveVersionBaseline,
  getVersionBaseline
};
