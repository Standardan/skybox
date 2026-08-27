"use client";

import { useEffect } from "react";
import { setTimezone } from "@/app/settings/home/actions";

const STORAGE_KEY = "skybox-timezone-auto-detected";

/**
 * Renders nothing — just saves the viewer's real browser timezone the
 * first time nobody's ever set one, so game/program times (Today's
 * Games, Sports, the live guide) are correct out of the box instead of
 * defaulting to UTC until someone finds the Settings control. Only runs
 * once per browser (a localStorage flag, not just checking against "UTC"
 * — otherwise a user who deliberately picked UTC in Settings would get
 * silently overridden back to their browser zone on their next visit).
 */
export function TimezoneAutoDetect({ currentTimezone }: { currentTimezone: string }) {
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      return; // localStorage unavailable (private mode, etc.) — skip rather than re-detect every load
    }
    if (currentTimezone !== "UTC") return; // already explicitly configured (or already detected before)
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== "UTC") {
      void setTimezone(detected);
    }
  }, [currentTimezone]);

  return null;
}
