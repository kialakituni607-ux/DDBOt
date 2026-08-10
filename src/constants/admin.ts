// Shared admin-account whitelist. Keep this in sync with server/index.js's
// ADMIN_ACCOUNTS constant — both must list the same login IDs.
export const ADMIN_ACCOUNTS = ['ROT92121668', 'DOT93534596'];

export const isAdminLoginid = (loginid?: string | null): boolean =>
    !!loginid && ADMIN_ACCOUNTS.includes(loginid);
