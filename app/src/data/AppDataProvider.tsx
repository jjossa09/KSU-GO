import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import type { EventSeed, Route } from '../../../shared/types.ts';
import campusEvents from '../../../shared/fixtures/events.seed.json';
import routeSample from '../../../shared/fixtures/route.sample.json';
import routeDraft from '../../../shared/fixtures/route.draft-flawed.json';
import routePlaceholder from '../../../shared/fixtures/routes/placeholder.draft.json';
import { createApiClient } from '../api/client.ts';
import { loadFixtureEvents } from './events.ts';
import { findFixtureRoute } from './routes.ts';
import { AppDataContext } from './AppDataContext.ts';
import { AppDataController } from './controller.ts';
import {
  getOrCreateDeviceId,
  loadOfflineRegisteredCounts,
  loadRegisteredEventIds,
  loadServerUrlOverride,
  saveOfflineRegisteredCounts,
  saveRegisteredEventIds,
  saveServerUrlOverride,
} from '../settings/storage.ts';

const fixtureSeeds = campusEvents as unknown as EventSeed[];
const fixtureRoutes = [routeSample, routeDraft, routePlaceholder] as unknown as Route[];

export function AppDataProvider({ children }: PropsWithChildren) {
  const controller = useMemo(
    () => new AppDataController({
      defaultApiUrl: process.env.EXPO_PUBLIC_API_URL,
      loadServerUrlOverride: () => loadServerUrlOverride(AsyncStorage),
      saveServerUrlOverride: (url) => saveServerUrlOverride(AsyncStorage, url),
      fixtureEvents: (now) => loadFixtureEvents(fixtureSeeds, now, 'today'),
      fixtureRoute: (id) => findFixtureRoute(fixtureRoutes, id),
      clientFactory: (url) => createApiClient(url),
    }),
    [],
  );
  const [state, setState] = useState(controller.state);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [registeredEventIds, setRegisteredEventIds] = useState<string[]>([]);
  const [offlineRegisteredCounts, setOfflineRegisteredCounts] = useState<Record<string, number>>({});
  const [registrationsReady, setRegistrationsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = controller.subscribe(setState);
    void controller.start();
    void Promise.all([
      getOrCreateDeviceId(AsyncStorage),
      loadRegisteredEventIds(AsyncStorage),
      loadOfflineRegisteredCounts(AsyncStorage),
    ]).then(([id, savedIds, savedCounts]) => {
      if (!mounted) return;
      setDeviceId(id);
      setRegisteredEventIds(savedIds);
      setOfflineRegisteredCounts(savedCounts);
      setRegistrationsReady(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  const registerEvent = useCallback(async (eventId: string) => {
    if (!deviceId) throw new Error('The device ID is not ready.');
    if (!registrationsReady) throw new Error('Saved registrations are still loading.');
    if (registeredEventIds.includes(eventId)) {
      return state.events.find((event) => event.id === eventId)?.registeredCount ?? 0;
    }

    const registeredCount = await controller.registerEvent(eventId, deviceId);
    const nextIds = [...registeredEventIds, eventId];
    await saveRegisteredEventIds(AsyncStorage, nextIds);
    setRegisteredEventIds(nextIds);

    if (controller.state.source === 'fixtures') {
      const nextCounts = { ...offlineRegisteredCounts, [eventId]: registeredCount };
      await saveOfflineRegisteredCounts(AsyncStorage, nextCounts);
      setOfflineRegisteredCounts(nextCounts);
    }
    return registeredCount;
  }, [controller, deviceId, offlineRegisteredCounts, registeredEventIds, registrationsReady, state.events]);

  const events = useMemo(() => state.events.map((event) => {
    const offlineCount = offlineRegisteredCounts[event.id];
    return state.source === 'fixtures' && offlineCount !== undefined
      ? { ...event, registeredCount: offlineCount }
      : event;
  }), [offlineRegisteredCounts, state.events, state.source]);

  const refresh = useCallback(() => controller.refresh(), [controller]);
  const setServerUrl = useCallback((url: string) => controller.setServerUrl(url), [controller]);
  const getRoute = useCallback((id: string) => controller.getRoute(id), [controller]);

  const value = useMemo(
    () => ({ ...state, events, deviceId, registeredEventIds, registrationsReady, registerEvent, refresh, setServerUrl, getRoute }),
    [deviceId, events, getRoute, refresh, registerEvent, registeredEventIds, registrationsReady, setServerUrl, state],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
