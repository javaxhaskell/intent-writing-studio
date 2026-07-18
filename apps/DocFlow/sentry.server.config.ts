// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// Enabled only in production AND when a DSN is provided via environment.
if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // 降低采样率，避免 429 错误
    tracesSampleRate: 0.1,

    // 禁用发送用户 PII，提升隐私保护
    sendDefaultPii: false,

    // 添加环境标识
    environment: 'production',

    // 忽略常见的良性错误
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'ChunkLoadError',
      'Loading chunk',
      'Failed to fetch',
    ],

    // 设置发布版本
    release: process.env.NEXT_PUBLIC_APP_VERSION,
  });
}
