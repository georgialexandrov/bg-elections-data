import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.PROD
    ? "https://0d0da7df7088753e036f602878ad8792@o4511213540540416.ingest.de.sentry.io/4511213567410256"
    : undefined,
  enabled: import.meta.env.PROD,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  ignoreErrors: [
    // Injected scripts from Facebook / Instagram in-app webviews on iOS.
    // WKWebView exposes window.webkit.messageHandlers; other embeddings don't.
    /webkit\.messageHandlers/,
    // Microsoft Outlook SafeLinks / Protected Services scanner bot — fires
    // when our links are scanned from Outlook. Not our code.
    /Object Not Found Matching Id:\d+, MethodName:update, ParamCount:\d+/,
  ],
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
