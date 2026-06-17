// PM2 process config for the FINNO CRM (Next.js production server).
//
// This runs the PRODUCTION build (`next start`), NOT `next dev`. Dev mode
// recompiles CSS on demand and serves un-hashed chunks that intermittently
// 404 on refresh — which is why styles randomly disappeared. A production
// build emits immutable, content-hashed CSS that caches safely.
//
// Deploy sequence on the server (run from this folder):
//   npm ci            # install exact deps
//   npm run build     # next build — MUST run after every code change
//   pm2 start ecosystem.config.js
//   pm2 save          # persist across reboots (also run `pm2 startup` once)
//
// After pulling new code: `npm run build && pm2 reload finno-crm`

module.exports = {
  apps: [
    {
      name: 'finno-crm',
      cwd: __dirname,
      // Call the Next.js CLI directly so PM2 manages the real process
      // (not an `npm` wrapper child it can't restart cleanly).
      script: './node_modules/next/dist/bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // Hostinger Node hosting injects PORT; default to 3000 locally.
        PORT: process.env.PORT || 3000,
      },
    },
  ],
}
