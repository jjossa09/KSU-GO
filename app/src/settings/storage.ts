export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const SERVER_URL_KEY = 'ksu-go.server-url';
const DEVICE_ID_KEY = 'ksu-go.device-id';
const REGISTERED_EVENT_IDS_KEY = 'ksu-go.registered-event-ids';
const OFFLINE_REGISTERED_COUNTS_KEY = 'ksu-go.offline-registered-counts';

export function normalizeServerUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveServerUrl(override: string | null, defaultApiUrl: string | undefined): string | null {
  return normalizeServerUrl(override) ?? normalizeServerUrl(defaultApiUrl);
}

export async function loadServerUrlOverride(storage: KeyValueStorage): Promise<string | null> {
  return normalizeServerUrl(await storage.getItem(SERVER_URL_KEY));
}

export async function saveServerUrlOverride(storage: KeyValueStorage, value: string): Promise<void> {
  const normalized = normalizeServerUrl(value);
  if (normalized) {
    await storage.setItem(SERVER_URL_KEY, normalized);
  } else {
    await storage.removeItem(SERVER_URL_KEY);
  }
}

export async function loadRegisteredEventIds(storage: KeyValueStorage): Promise<string[]> {
  const serialized = await storage.getItem(REGISTERED_EVENT_IDS_KEY);
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
  } catch {
    return [];
  }
}

export async function saveRegisteredEventIds(storage: KeyValueStorage, eventIds: string[]): Promise<void> {
  await storage.setItem(REGISTERED_EVENT_IDS_KEY, JSON.stringify([...new Set(eventIds)]));
}

export async function loadOfflineRegisteredCounts(storage: KeyValueStorage): Promise<Record<string, number>> {
  const serialized = await storage.getItem(OFFLINE_REGISTERED_COUNTS_KEY);
  if (!serialized) return {};
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] >= 0
    )));
  } catch {
    return {};
  }
}

export async function saveOfflineRegisteredCounts(storage: KeyValueStorage, counts: Record<string, number>): Promise<void> {
  await storage.setItem(OFFLINE_REGISTERED_COUNTS_KEY, JSON.stringify(counts));
}

function createDeviceId(): string {
  return `ksu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function getOrCreateDeviceId(
  storage: KeyValueStorage,
  idFactory: () => string = createDeviceId,
): Promise<string> {
  const existing = await storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const created = idFactory();
  await storage.setItem(DEVICE_ID_KEY, created);
  return created;
}
