import type { Event, Route } from '../../../shared/types.ts';
import { ApiRequestError, type ApiClient } from '../api/client.ts';
import { normalizeServerUrl, resolveServerUrl } from '../settings/storage.ts';

export const HEALTH_TIMEOUT_MS = 2_000;
export const HEALTH_POLL_INTERVAL_MS = 10_000;
export const EVENTS_TIMEOUT_MS = 2_000;

type DataApi = Pick<ApiClient, 'health' | 'listEvents' | 'getRoute' | 'register'>;
type PollScheduler = (callback: () => Promise<void>, intervalMs: number) => unknown;
type PollCanceler = (handle: unknown) => void;

export type AppDataState = {
  source: 'server' | 'fixtures';
  offline: boolean;
  serverUrl: string | null;
  events: Event[];
  now: Date;
};

export type AppDataControllerOptions = {
  defaultApiUrl?: string;
  loadServerUrlOverride: () => Promise<string | null>;
  saveServerUrlOverride: (url: string) => Promise<void>;
  fixtureEvents: (now: Date) => Event[];
  fixtureRoute: (id: string) => Route | null;
  clientFactory: (url: string) => DataApi;
  healthTimeoutMs?: number;
  eventsTimeoutMs?: number;
  pollIntervalMs?: number;
  schedulePoll?: PollScheduler;
  cancelPoll?: PollCanceler;
  now?: () => Date;
};

export class AppDataController {
  private readonly defaultApiUrl: string | undefined;
  private readonly loadServerUrlOverride: () => Promise<string | null>;
  private readonly saveServerUrlOverride: (url: string) => Promise<void>;
  private readonly fixtureEvents: (now: Date) => Event[];
  private readonly fixtureRoute: (id: string) => Route | null;
  private readonly clientFactory: (url: string) => DataApi;
  private readonly healthTimeoutMs: number;
  private readonly eventsTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly schedulePoll: PollScheduler;
  private readonly cancelPoll: PollCanceler;
  private readonly now: () => Date;
  private readonly listeners = new Set<(state: AppDataState) => void>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private override: string | null = null;
  private current: AppDataState;
  private pollHandle: unknown = null;
  private generation = 0;
  private started = false;

  constructor(options: AppDataControllerOptions) {
    this.defaultApiUrl = options.defaultApiUrl;
    this.loadServerUrlOverride = options.loadServerUrlOverride;
    this.saveServerUrlOverride = options.saveServerUrlOverride;
    this.fixtureEvents = options.fixtureEvents;
    this.fixtureRoute = options.fixtureRoute;
    this.clientFactory = options.clientFactory;
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    this.eventsTimeoutMs = options.eventsTimeoutMs ?? EVENTS_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? HEALTH_POLL_INTERVAL_MS;
    this.schedulePoll = options.schedulePoll ?? ((callback, intervalMs) => setInterval(() => { void callback(); }, intervalMs));
    this.cancelPoll = options.cancelPoll ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    this.now = options.now ?? (() => new Date());
    const initialNow = this.now();
    this.current = {
      source: 'fixtures',
      offline: true,
      serverUrl: resolveServerUrl(null, this.defaultApiUrl),
      events: this.fixtureEvents(initialNow),
      now: initialNow,
    };
  }

  get state(): AppDataState {
    return this.current;
  }

  subscribe(listener: (state: AppDataState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.override = normalizeServerUrl(await this.loadServerUrlOverride());
    const generation = ++this.generation;
    this.update({ ...this.current, serverUrl: this.effectiveServerUrl });
    this.pollHandle = this.schedulePoll(() => this.refresh(), this.pollIntervalMs);
    await this.refreshGeneration(generation);
  }

  stop(): void {
    this.started = false;
    this.generation += 1;
    if (this.pollHandle !== null) this.cancelPoll(this.pollHandle);
    this.pollHandle = null;
  }

  async setServerUrl(url: string): Promise<void> {
    this.override = normalizeServerUrl(url);
    await this.saveServerUrlOverride(this.override ?? '');
    const generation = ++this.generation;
    const now = this.now();
    this.update({
      source: 'fixtures',
      offline: true,
      serverUrl: this.effectiveServerUrl,
      events: this.fixtureEvents(now),
      now,
    });
    await this.refreshGeneration(generation);
  }

  async refresh(): Promise<void> {
    return this.refreshGeneration(this.generation);
  }

  async getRoute(id: string): Promise<Route | null> {
    const fallback = this.fixtureRoute(id);
    if (this.current.source !== 'server' || !this.current.serverUrl) return fallback;

    try {
      return await this.clientFactory(this.current.serverUrl).getRoute(id);
    } catch (error) {
      if (error instanceof ApiRequestError) throw error;
      const now = this.now();
      this.update({
        source: 'fixtures',
        offline: true,
        serverUrl: this.effectiveServerUrl,
        events: this.fixtureEvents(now),
        now,
      });
      return fallback;
    }
  }

  async registerEvent(eventId: string, deviceId: string): Promise<number> {
    if (this.current.source === 'server' && this.current.serverUrl) {
      try {
        const response = await this.clientFactory(this.current.serverUrl).register(eventId, deviceId);
        this.update({
          ...this.current,
          events: this.current.events.map((event) => event.id === eventId
            ? { ...event, registeredCount: response.registeredCount }
            : event),
        });
        return response.registeredCount;
      } catch (error) {
        if (error instanceof ApiRequestError) throw error;
        this.useFixtures(this.generation, this.now());
      }
    }

    const event = this.current.events.find((item) => item.id === eventId);
    if (!event) throw new Error(`Event ${eventId} is not available.`);
    const registeredCount = event.registeredCount + 1;
    this.update({
      ...this.current,
      events: this.current.events.map((item) => item.id === eventId ? { ...item, registeredCount } : item),
    });
    return registeredCount;
  }

  private get effectiveServerUrl(): string | null {
    return resolveServerUrl(this.override, this.defaultApiUrl);
  }

  private refreshGeneration(generation: number): Promise<void> {
    const current = this.inFlight.get(generation);
    if (current) return current;

    const refresh = this.refreshForGeneration(generation).finally(() => {
      this.inFlight.delete(generation);
    });
    this.inFlight.set(generation, refresh);
    return refresh;
  }

  private async refreshForGeneration(generation: number): Promise<void> {
    const url = this.effectiveServerUrl;
    const now = this.now();
    if (!url) {
      this.useFixtures(generation, now);
      return;
    }

    const client = this.clientFactory(url);
    try {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Health check timed out.'));
        }, this.healthTimeoutMs);
      });
      let health: Awaited<ReturnType<DataApi['health']>>;
      try {
        health = await Promise.race([client.health(controller.signal), timeoutPromise]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      if (!health.ok) throw new Error('Health check did not report ok.');
      const eventsController = new AbortController();
      let eventsTimeout: ReturnType<typeof setTimeout> | undefined;
      const eventsTimeoutPromise = new Promise<never>((_, reject) => {
        eventsTimeout = setTimeout(() => {
          eventsController.abort();
          reject(new Error('Events request timed out.'));
        }, this.eventsTimeoutMs);
      });
      let events: Event[];
      try {
        events = await Promise.race([
          client.listEvents('today', eventsController.signal),
          eventsTimeoutPromise,
        ]);
      } finally {
        if (eventsTimeout !== undefined) clearTimeout(eventsTimeout);
      }
      if (generation !== this.generation) return;
      this.update({ source: 'server', offline: false, serverUrl: url, events, now: this.now() });
    } catch {
      this.useFixtures(generation, this.now());
    }
  }

  private useFixtures(generation: number, now: Date): void {
    if (generation !== this.generation) return;
    this.update({
      source: 'fixtures',
      offline: true,
      serverUrl: this.effectiveServerUrl,
      events: this.fixtureEvents(now),
      now,
    });
  }

  private update(state: AppDataState): void {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}
