// PM2 config — zaženemo šele ko je projekt pripravljen za produkcijo
// Za razvoj: npm run dev (v src/server) + cd client && npm run dev
module.exports = {
  apps: [
    {
      name: 'ai-vs-humanity',
      script: './dist/server/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
