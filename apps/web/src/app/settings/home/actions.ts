"use server";

import type { UiPrefs } from "@skybox/core/shared";
import { updateConfig } from "@/lib/config-store";

export async function moveRail(railId: string, direction: "up" | "down"): Promise<UiPrefs> {
  const config = await updateConfig((c) => {
    const order = [...c.ui.railOrder];
    const index = order.indexOf(railId);
    if (index === -1) return c;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= order.length) return c;
    const tmp = order[index]!;
    order[index] = order[swapWith]!;
    order[swapWith] = tmp;
    return { ...c, ui: { ...c.ui, railOrder: order } };
  });
  return config.ui;
}

export async function setRailVisible(railId: string, visible: boolean): Promise<UiPrefs> {
  const config = await updateConfig((c) => {
    const hiddenRails = visible ? c.ui.hiddenRails.filter((id) => id !== railId) : [...new Set([...c.ui.hiddenRails, railId])];
    return { ...c, ui: { ...c.ui, hiddenRails } };
  });
  return config.ui;
}

export async function setSportsFirst(sportsFirst: boolean): Promise<UiPrefs> {
  const config = await updateConfig((c) => ({ ...c, ui: { ...c.ui, sportsFirst } }));
  return config.ui;
}
