// src/app/api/_banStore.ts
export interface BanInfo {
  ip: string;
  userAgent: string;
  count: number;
  lastAttempt: number;
  banUntil: number;
  filledHoneypot: boolean;
}

// ✅ Shared in-memory ban store
export const failedAttempts: Record<string, BanInfo> = {};
