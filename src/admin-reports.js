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

/**
 * Fetch recent GTM activity from the Google Workspace Admin SDK Reports API.
 * Returns a map of containerId -> [{ email, eventName, time }]
 * Returns null if access is denied (not a Workspace admin).
 */
async function getRecentGtmActivity(sinceHours = 72) {
  const auth = getAuthClient();
  const admin = google.admin({ version: 'reports_v1', auth });

  const startTime = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  try {
    const res = await admin.activities.list({
      userKey: 'all',
      applicationName: 'tagmanager',
      startTime
    });

    const activities = res.data.items || [];
    const activityByContainer = {};

    for (const activity of activities) {
      const email = activity.actor && activity.actor.email;
      const time = activity.id && activity.id.time;
      const events = activity.events || [];

      for (const event of events) {
        const params = event.parameters || [];
        const containerIdParam = params.find(p => p.name === 'CONTAINER_ID');
        if (!containerIdParam) continue;

        const containerId = String(containerIdParam.value || containerIdParam.intValue || '');
        if (!containerId) continue;

        if (!activityByContainer[containerId]) {
          activityByContainer[containerId] = [];
        }

        activityByContainer[containerId].push({
          email: email || 'unknown',
          eventName: event.name || 'unknown',
          time: time || new Date().toISOString()
        });
      }
    }

    return activityByContainer;
  } catch (err) {
    if (err.code === 403 || err.status === 403) {
      console.warn('[AdminReports] Access denied — Reports API requires Google Workspace admin access. User emails will not be shown.');
      return null;
    }
    console.warn(`[AdminReports] Could not fetch activity: ${err.message}`);
    return null;
  }
}

/**
 * Get unique actor emails for a specific container, most recent first.
 */
function getActorsForContainer(activityMap, containerId) {
  if (!activityMap) return [];
  const events = activityMap[containerId] || [];

  const emailLatest = {};
  for (const event of events) {
    if (event.email && event.email !== 'unknown') {
      if (!emailLatest[event.email] || event.time > emailLatest[event.email]) {
        emailLatest[event.email] = event.time;
      }
    }
  }

  return Object.keys(emailLatest).sort((a, b) =>
    emailLatest[b].localeCompare(emailLatest[a])
  );
}

module.exports = { getRecentGtmActivity, getActorsForContainer };
