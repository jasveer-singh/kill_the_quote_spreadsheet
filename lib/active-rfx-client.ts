import { RfxSchema } from "./rfx-schema";
import type { Rfx } from "./rfx-types";

export const ACTIVE_RFX_KEY = "activeRfx";

/** Browser only. Returns the confirmed RFx, or null if none is stored, it is invalid, or storage is unavailable. */
export function getActiveRfx(): Rfx | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_RFX_KEY);
    if (!raw) return null;
    const parsed = RfxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as Rfx) : null;
  } catch {
    return null;
  }
}

/** Browser only. Returns false if the RFx is invalid or the write failed (private mode, quota, blocked storage). */
export function setActiveRfx(rfx: Rfx): boolean {
  try {
    const parsed = RfxSchema.parse(rfx);
    window.localStorage.setItem(ACTIVE_RFX_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}
