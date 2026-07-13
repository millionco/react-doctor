const integrationDefaults = {
  notifications: {
    slackWebhookUrl: "configured-server-side",
    discordWebhookUrl: "configured-server-side",
  },
  database: {
    DATABASE_URL: "postgres://integrations:dashboard-password@db.internal.example.com/integrations",
  },
  email: {
    sendgridApiKey: "configured-server-side",
  },
  billing: {
    stripeRestrictedKey: "configured-server-side",
  },
  ai: {
    openAiProjectKey: "configured-server-side",
    anthropicKey: "configured-server-side",
  },
  developerTools: {
    linearApiKey: "configured-server-side",
    vercelToken: "configured-server-side",
    sentryAuthToken: "configured-server-side",
  },
};

window.__INTEGRATIONS_DASHBOARD_CONFIG__ = integrationDefaults;
