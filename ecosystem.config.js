'use strict';

// PM2-configuratie voor de MindGit-agent.
//   pm2 start ecosystem.config.js
//   pm2 save
//
// De agent leest zijn instellingen uit .env (via dotenv). Zet daar
// COORDINATOR_URL en NODE_KEY in.
module.exports = {
  apps: [
    {
      name: 'MindGitAgent',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      max_memory_restart: '200M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
