import { createDefaultSettings, type ViewSettings } from "./view-settings.ts";

const STORAGE_KEY = "hrt-voice-trainer:settings";

function loadStoredSettings(): Partial<ViewSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / quota exceeded — settings just won't persist this session.
  }
}

/** A settings object seeded from localStorage (falling back to defaults) that auto-saves on every change. */
export function createPersistedSettings(): ViewSettings {
  const merged: ViewSettings = { ...createDefaultSettings(), ...loadStoredSettings() };
  return new Proxy(merged, {
    set(target, prop, value) {
      Reflect.set(target, prop, value);
      saveSettings(target);
      return true;
    },
  });
}
