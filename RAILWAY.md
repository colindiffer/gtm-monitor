# Railway Deployment

This project maps cleanly to a Railway cron job.

## Recommended setup

1. Create a new Railway service from this repo.
2. Keep the service as a scheduled job, not a long-running web service.
3. Attach a volume and mount it at `/app/state`.
4. Deploy with the included `railway.toml`.

The service is configured to run `npm run check` every 2 hours with the UTC cron schedule `0 */2 * * *`.

## Required Railway variables

Add these in the Railway service Variables tab:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`
- `SLACK_WEBHOOK_URL`

Optional overrides:

- `STATE_DIR` if you want to store state somewhere other than the mounted volume path
- `STATE_FILE` if you want to point directly at a specific JSON file

If `STATE_FILE` is not set, the app uses:

1. `STATE_DIR/last-seen.json`
2. `RAILWAY_VOLUME_MOUNT_PATH/last-seen.json`
3. `./state/last-seen.json`

## OAuth bootstrap

You should not run `npm run auth` on Railway. The OAuth flow opens a browser and listens on `http://localhost:3000/oauth/callback`, so do this locally once instead:

1. Fill in local `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback`
2. Run `npm run auth`
3. Copy the resulting `GOOGLE_REFRESH_TOKEN` into Railway variables

After that, Railway can run unattended.

## Notes

- Railway cron jobs run in UTC, not local time.
- Railway scheduled services must exit when finished; `npm run check` already does that.
- The mounted volume is important because the monitor relies on `last-seen.json` to avoid treating every run like a first run.
