import { isAdminLoginid } from '@/constants/admin';

const key = (loginid: string) => `virtual_balance_cache:${loginid}`;

export const isAdminSession = (): boolean => isAdminLoginid(localStorage.getItem('active_loginid'));

export const getCachedVirtualBalance = (): number | null => {
    try {
        const loginid = localStorage.getItem('active_loginid');
        if (!loginid || !isAdminLoginid(loginid)) return null;
        const v = localStorage.getItem(key(loginid));
        const n = v === null ? NaN : Number(v);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
};

export const setCachedVirtualBalance = (b: number): void => {
    try {
        const loginid = localStorage.getItem('active_loginid');
        if (loginid && isAdminLoginid(loginid)) localStorage.setItem(key(loginid), String(b));
    } catch {
        /* ignore */
    }
};
