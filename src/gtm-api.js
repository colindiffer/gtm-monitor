'use strict';

const { google } = require('googleapis');
require('dotenv').config();

function getAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

function getTagManager() {
  const auth = getAuthClient();
  return google.tagmanager({ version: 'v2', auth });
}

async function listWorkspaces(accountId, containerId) {
  const tagmanager = getTagManager();
  const parent = `accounts/${accountId}/containers/${containerId}`;
  const res = await tagmanager.accounts.containers.workspaces.list({ parent });
  return res.data.workspace || [];
}

async function getWorkspaceStatus(accountId, containerId, workspaceId) {
  const tagmanager = getTagManager();
  const path = `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;
  const res = await tagmanager.accounts.containers.workspaces.getStatus({ path });
  return res.data;
}

async function getWorkspace(accountId, containerId, workspaceId) {
  const tagmanager = getTagManager();
  const path = `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;
  const res = await tagmanager.accounts.containers.workspaces.get({ path });
  return res.data;
}

async function listVersionHeaders(accountId, containerId) {
  const tagmanager = getTagManager();
  const parent = `accounts/${accountId}/containers/${containerId}`;
  const res = await tagmanager.accounts.containers.version_headers.list({ parent });
  return res.data.containerVersionHeader || [];
}

async function getLatestPublishedVersion(accountId, containerId) {
  const tagmanager = getTagManager();
  const parent = `accounts/${accountId}/containers/${containerId}`;
  const res = await tagmanager.accounts.containers.version_headers.list({ parent });
  const headers = (res.data.containerVersionHeader || [])
    .filter(v => !v.deleted)
    .sort((a, b) => parseInt(b.containerVersionId) - parseInt(a.containerVersionId));

  if (headers.length === 0) return null;

  const latest = headers[0];
  const previous = headers[1] || null;

  // Fetch both versions to diff them
  const getItems = (version) => {
    const map = {};
    const entityTypes = { tags: 'tag', triggers: 'trigger', variables: 'variable', customTemplates: 'customTemplate' };
    for (const [key, type] of Object.entries(entityTypes)) {
      for (const item of (version[key] || [])) {
        map[`${type}::${item.name}`] = { type, name: item.name, fingerprint: item.fingerprint };
      }
    }
    return map;
  };

  const latestPath = `accounts/${accountId}/containers/${containerId}/versions/${latest.containerVersionId}`;
  const latestRes = await tagmanager.accounts.containers.versions.get({ path: latestPath });
  const latestItems = getItems(latestRes.data);

  let diff = [];
  if (previous) {
    const prevPath = `accounts/${accountId}/containers/${containerId}/versions/${previous.containerVersionId}`;
    const prevRes = await tagmanager.accounts.containers.versions.get({ path: prevPath });
    const prevItems = getItems(prevRes.data);

    for (const [key, item] of Object.entries(latestItems)) {
      if (!prevItems[key]) {
        diff.push({ changeType: 'added', entityType: item.type, name: item.name });
      } else if (prevItems[key].fingerprint !== item.fingerprint) {
        diff.push({ changeType: 'updated', entityType: item.type, name: item.name });
      }
    }
    for (const [key, item] of Object.entries(prevItems)) {
      if (!latestItems[key]) {
        diff.push({ changeType: 'deleted', entityType: item.type, name: item.name });
      }
    }
  }

  return {
    versionId: latest.containerVersionId,
    versionName: latest.name || `Version ${latest.containerVersionId}`,
    description: latest.description || '',
    diff
  };
}

async function getVersionsSince(accountId, containerId, sinceVersionId) {
  const tagmanager = getTagManager();
  const parent = `accounts/${accountId}/containers/${containerId}`;
  const res = await tagmanager.accounts.containers.version_headers.list({ parent });
  const headers = (res.data.containerVersionHeader || []).filter(v => !v.deleted);

  return headers
    .filter(v => parseInt(v.containerVersionId) > sinceVersionId)
    .map(v => ({
      versionId: v.containerVersionId,
      versionName: v.name || `Version ${v.containerVersionId}`,
      description: v.description || ''
    }))
    .sort((a, b) => parseInt(a.versionId) - parseInt(b.versionId));
}

async function getLatestVersionId(accountId, containerId) {
  const tagmanager = getTagManager();
  const parent = `accounts/${accountId}/containers/${containerId}`;
  const res = await tagmanager.accounts.containers.version_headers.list({ parent });
  const headers = (res.data.containerVersionHeader || []).filter(v => !v.deleted);
  if (headers.length === 0) return 0;
  return Math.max(...headers.map(v => parseInt(v.containerVersionId) || 0));
}

async function getContainerChanges(accountId, containerId) {
  const workspaces = await listWorkspaces(accountId, containerId);
  const results = [];

  for (const ws of workspaces) {
    const wsId = ws.workspaceId;
    const status = await getWorkspaceStatus(accountId, containerId, wsId);

    const changes = [];

    if (status.workspaceChange) {
      for (const change of status.workspaceChange) {
        const entity = change.tag || change.trigger || change.variable ||
                       change.folder || change.builtInVariable || change.customTemplate;
        const entityType = change.tag ? 'tag' :
                           change.trigger ? 'trigger' :
                           change.variable ? 'variable' :
                           change.folder ? 'folder' :
                           change.builtInVariable ? 'builtInVariable' :
                           change.customTemplate ? 'customTemplate' : 'unknown';

        changes.push({
          changeType: change.changeStatus,
          entityType,
          name: entity ? (entity.name || entity.variableId || 'unnamed') : 'unknown',
          details: entity || {}
        });
      }
    }

    results.push({
      workspaceId: wsId,
      workspaceName: ws.name,
      description: ws.description || '',
      fingerprint: ws.fingerprint,
      changes
    });
  }

  return results;
}

module.exports = { listWorkspaces, getWorkspaceStatus, getWorkspace, listVersionHeaders, getLatestPublishedVersion, getVersionsSince, getLatestVersionId, getContainerChanges };
