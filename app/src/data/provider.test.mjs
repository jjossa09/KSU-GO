import assert from 'node:assert/strict';
import test from 'node:test';

import { getOrCreateDeviceId, loadOfflineRegisteredCounts, loadRegisteredEventIds, loadServerUrlOverride, resolveServerUrl, saveOfflineRegisteredCounts, saveRegisteredEventIds, saveServerUrlOverride } from '../settings/storage.ts';
import { AppDataController } from './controller.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

function makeController(overrides = {}) {
  let savedOverride = null;
  let poll;
  let interval;
  const options = {
    defaultApiUrl: 'http://default.test',
    loadServerUrlOverride: async () => savedOverride,
    saveServerUrlOverride: async (url) => { savedOverride = url; },
    fixtureEvents: () => [{ id: 'fixture' }],
    fixtureRoute: () => null,
    clientFactory: () => ({ health: async () => ({ ok: true, pipelineMode: 'mock' }), listEvents: async () => [{ id: 'server' }], getRoute: async () => ({ id: 'route-server' }) }),
    schedulePoll: (callback, delay) => { poll = callback; interval = delay; return 1; },
    cancelPoll: () => {},
    now: () => new Date('2026-11-17T12:00:00.000Z'),
    ...overrides,
  };
  return {
    controller: new AppDataController(options),
    getPoll: () => poll,
    getInterval: () => interval,
    getSavedOverride: () => savedOverride,
  };
}

test('blank URL overrides fall back to EXPO_PUBLIC_API_URL and persist stable device ids', async () => {
  const storage = memoryStorage();
  await saveServerUrlOverride(storage, ' https://server.test/ ');
  assert.equal(await loadServerUrlOverride(storage), 'https://server.test/');
  await saveServerUrlOverride(storage, '  ');
  assert.equal(await loadServerUrlOverride(storage), null);
  assert.equal(resolveServerUrl(await loadServerUrlOverride(storage), 'https://default.test/'), 'https://default.test/');

  let generated = 0;
  const first = await getOrCreateDeviceId(storage, () => `device-${++generated}`);
  const second = await getOrCreateDeviceId(storage, () => `device-${++generated}`);
  assert.equal(first, 'device-1');
  assert.equal(second, first);
  assert.equal(generated, 1);
});

test('persists registered event ids and ignores malformed storage values', async () => {
  const storage = memoryStorage();
  await saveRegisteredEventIds(storage, ['event-1', 'event-2']);
  assert.deepEqual(await loadRegisteredEventIds(storage), ['event-1', 'event-2']);

  await storage.setItem('ksu-go.registered-event-ids', '{bad json');
  assert.deepEqual(await loadRegisteredEventIds(storage), []);

  await saveOfflineRegisteredCounts(storage, { 'event-1': 5, invalid: -1 });
  assert.deepEqual(await loadOfflineRegisteredCounts(storage), { 'event-1': 5 });
});

test('uses fixtures immediately when no server URL is configured', async () => {
  const { controller } = makeController({ defaultApiUrl: '', loadServerUrlOverride: async () => null });
  await controller.start();
  assert.equal(controller.state.source, 'fixtures');
  assert.equal(controller.state.offline, true);
  assert.deepEqual(controller.state.events, [{ id: 'fixture' }]);
  controller.stop();
});

test('falls back when health does not answer before the timeout', async () => {
  const { controller } = makeController({
    healthTimeoutMs: 5,
    clientFactory: () => ({ health: () => new Promise(() => {}), listEvents: async () => [], getRoute: async () => null }),
  });
  await controller.start();
  assert.equal(controller.state.source, 'fixtures');
  controller.stop();
});

test('falls back when the events request hangs after a healthy response', async () => {
  let eventsSignal;
  const { controller } = makeController({
    eventsTimeoutMs: 5,
    clientFactory: () => ({
      health: async () => ({ ok: true, pipelineMode: 'mock' }),
      listEvents: (_range, signal) => {
        eventsSignal = signal;
        return new Promise(() => {});
      },
      getRoute: async () => null,
    }),
  });

  const started = await Promise.race([
    controller.start().then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  controller.stop();

  assert.equal(started, true, 'startup should finish after the events timeout');
  assert.equal(controller.state.source, 'fixtures');
  assert.equal(eventsSignal?.aborted, true);
});

test('polls every ten seconds and switches back to server data when health recovers', async () => {
  let healthy = false;
  const { controller, getPoll, getInterval } = makeController({
    clientFactory: () => ({
      health: async () => { if (!healthy) throw new Error('offline'); return { ok: true, pipelineMode: 'mock' }; },
      listEvents: async () => [{ id: 'server' }],
      getRoute: async () => ({ id: 'route-server' }),
    }),
  });

  await controller.start();
  assert.equal(controller.state.source, 'fixtures');
  assert.equal(getInterval(), 10_000);
  healthy = true;
  await getPoll()();
  assert.equal(controller.state.source, 'server');
  assert.equal(controller.state.offline, false);
  assert.deepEqual(controller.state.events, [{ id: 'server' }]);
  controller.stop();
});

test('changing the server URL refreshes immediately and later polls use the new URL', async () => {
  let overrideHealthy = false;
  const { controller, getPoll, getSavedOverride } = makeController({
    clientFactory: (url) => ({
      health: async () => {
        if (url === 'http://override.test/' && !overrideHealthy) throw new Error('offline');
        return { ok: true, pipelineMode: 'mock' };
      },
      listEvents: async () => [{ id: url }],
      getRoute: async () => ({ id: url }),
    }),
  });
  await controller.start();
  await controller.setServerUrl(' http://override.test/ ');
  assert.equal(getSavedOverride(), 'http://override.test/');
  assert.equal(controller.state.serverUrl, 'http://override.test/');
  assert.equal(controller.state.source, 'fixtures');

  overrideHealthy = true;
  await getPoll()();
  assert.equal(controller.state.source, 'server');
  assert.deepEqual(controller.state.events, [{ id: 'http://override.test/' }]);
  controller.stop();
});

test('registers an event in fixture mode and increments its local count', async () => {
  const { controller } = makeController({
    defaultApiUrl: '',
    fixtureEvents: () => [{ id: 'event-1', registeredCount: 4 }],
    loadServerUrlOverride: async () => null,
  });

  await controller.start();
  const registeredCount = await controller.registerEvent('event-1', 'device-1');

  assert.equal(registeredCount, 5);
  assert.equal(controller.state.events[0].registeredCount, 5);
  controller.stop();
});

test('registers with the server and uses its returned count', async () => {
  let registration;
  const { controller } = makeController({
    fixtureEvents: () => [{ id: 'event-1', registeredCount: 4 }],
    clientFactory: () => ({
      health: async () => ({ ok: true, pipelineMode: 'mock' }),
      listEvents: async () => [{ id: 'event-1', registeredCount: 4 }],
      getRoute: async () => null,
      register: async (eventId, deviceId) => {
        registration = { eventId, deviceId };
        return { registered: true, registeredCount: 5 };
      },
    }),
  });

  await controller.start();
  const registeredCount = await controller.registerEvent('event-1', 'device-1');

  assert.deepEqual(registration, { eventId: 'event-1', deviceId: 'device-1' });
  assert.equal(registeredCount, 5);
  assert.equal(controller.state.events[0].registeredCount, 5);
  controller.stop();
});

test('falls back to a local registration when the server is unreachable', async () => {
  const { controller } = makeController({
    fixtureEvents: () => [{ id: 'event-1', registeredCount: 4 }],
    clientFactory: () => ({
      health: async () => ({ ok: true, pipelineMode: 'mock' }),
      listEvents: async () => [{ id: 'event-1', registeredCount: 4 }],
      getRoute: async () => null,
      register: async () => { throw new TypeError('network unavailable'); },
    }),
  });

  await controller.start();
  const registeredCount = await controller.registerEvent('event-1', 'device-1');

  assert.equal(controller.state.source, 'fixtures');
  assert.equal(registeredCount, 5);
  assert.equal(controller.state.events[0].registeredCount, 5);
  controller.stop();
});
