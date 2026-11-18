import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import campusFixture from '../../../shared/fixtures/campus.json';
import type { Campus, Event } from '../../../shared/types.ts';
import { useAppData } from '../../src/data/AppDataContext';
import { getEventFlagState } from '../../src/data/events';
import { ViewerWebView, type ViewerWebViewHandle } from '../../src/viewer/ViewerWebView';
import type { ViewerToAppMessage } from '../../src/viewer/bridge';
import { viewerHtml } from '../../src/viewerHtml';

const campus = campusFixture as Campus;

export default function MapScreen() {
  const router = useRouter();
  const viewer = useRef<ViewerWebViewHandle>(null);
  const {
    events,
    now,
    refresh,
    registeredEventIds,
    registrationsReady,
    registerEvent,
  } = useAppData();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const initialMessage = useMemo(() => ({
    type: 'campus:load' as const,
    campus,
    events,
    now: now.toISOString(),
    savedEventIds: registeredEventIds,
  }), [events, now, registeredEventIds]);

  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const routeEvent = events.find((event) => event.routeId !== null) ?? null;
  const selectedBuilding = selectedEvent
    ? campus.buildings.find((building) => building.id === selectedEvent.location.buildingId)
    : null;

  const selectEvent = useCallback((eventId: string) => {
    if (!events.some((event) => event.id === eventId)) return;
    setSelectedEventId(eventId);
    setRegisterError(null);
    viewer.current?.send({ type: 'campus:select', eventId });
  }, [events]);

  const handleViewerMessage = useCallback((message: ViewerToAppMessage) => {
    if (message.type === 'campus:flagTapped') selectEvent(message.eventId);
    if (message.type === 'error') setMapError(message.message);
  }, [selectEvent]);

  const handleRegister = async (event: Event) => {
    if (registering || registeredEventIds.includes(event.id) || !registrationsReady) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      await registerEvent(event.id);
    } catch {
      setRegisterError('Registration could not be saved. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  const takeMeThere = (event: Event) => {
    if (!event.routeId) return;
    setSelectedEventId(null);
    router.push({ pathname: '/(tabs)/route', params: { routeId: event.routeId } });
  };

  const timeLabel = (event: Event) => {
    const state = getEventFlagState(event, now);
    if (state === 'live') return 'Live now';
    const minutesUntilStart = Math.max(0, Math.ceil((Date.parse(event.startsAt) - now.getTime()) / 60_000));
    return `Starts in ${minutesUntilStart} min`;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.map}>
        <ViewerWebView
          ref={viewer}
          source={{ html: viewerHtml }}
          initialMessage={initialMessage}
          onMessage={handleViewerMessage}
          onError={() => setMapError('The campus map could not be loaded.')}
        />
        {mapError ? <Text accessibilityRole="alert" style={styles.mapError}>{mapError}</Text> : null}
      </View>

      {__DEV__ ? (
        <View style={styles.devButtons}>
          {routeEvent ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => handleViewerMessage({ type: 'campus:flagTapped', eventId: routeEvent.id })}
              style={styles.devButton}
            >
              <Text style={styles.devButtonText}>Dev: event with route</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refresh}>
        <Text style={styles.refreshText}>Refresh events</Text>
      </Pressable>

      <Modal
        visible={selectedEvent !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedEventId(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel="Close event details" onPress={() => setSelectedEventId(null)} style={styles.backdrop} />
          {selectedEvent ? (
            <View accessibilityViewIsModal style={styles.sheet}>
              <View style={styles.grabber} />
              <Text style={styles.eventTitle}>{selectedEvent.title}</Text>
              <Text style={styles.detail}>{selectedEvent.organizer} · {selectedEvent.category}</Text>
              <Text style={styles.detail}>{timeLabel(selectedEvent)} · {new Date(selectedEvent.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
              <Text style={styles.detail}>{selectedBuilding?.name ?? selectedEvent.location.buildingId} · Room {selectedEvent.location.room}</Text>
              <Text style={styles.count}>{events.find((event) => event.id === selectedEvent.id)?.registeredCount ?? selectedEvent.registeredCount} registered</Text>

              {registerError ? <Text accessibilityRole="alert" style={styles.error}>{registerError}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={registering || !registrationsReady || registeredEventIds.includes(selectedEvent.id)}
                onPress={() => void handleRegister(selectedEvent)}
                style={[styles.primaryButton, (registering || !registrationsReady || registeredEventIds.includes(selectedEvent.id)) && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>
                  {registeredEventIds.includes(selectedEvent.id) ? 'Registered' : registering ? 'Registering…' : 'Register'}
                </Text>
              </Pressable>

              {selectedEvent.routeId ? (
                <Pressable accessibilityRole="button" onPress={() => takeMeThere(selectedEvent)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Take me there</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101820' },
  map: { flex: 1 },
  mapError: { position: 'absolute', alignSelf: 'center', top: '45%', color: '#fff', backgroundColor: '#a52b22', padding: 10, borderRadius: 8 },
  refresh: { position: 'absolute', top: 12, right: 12, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#ffffffed' },
  refreshText: { color: '#17212a', fontWeight: '700', fontSize: 12 },
  devButtons: { position: 'absolute', top: 10, left: 10, gap: 6 },
  devButton: { alignSelf: 'flex-start', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: '#f0b849' },
  devButtonText: { color: '#17212a', fontWeight: '700', fontSize: 12 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: '#0008' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 30, backgroundColor: '#f8fafb' },
  grabber: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, marginBottom: 16, backgroundColor: '#bbc4ca' },
  eventTitle: { color: '#17212a', fontSize: 22, fontWeight: '700' },
  detail: { color: '#53616c', marginTop: 7, fontSize: 14 },
  count: { color: '#17212a', marginTop: 13, marginBottom: 5, fontSize: 14, fontWeight: '600' },
  error: { color: '#a52b22', marginTop: 10, fontSize: 13 },
  primaryButton: { alignItems: 'center', borderRadius: 11, marginTop: 13, paddingVertical: 14, backgroundColor: '#805b08' },
  disabledButton: { opacity: 0.55 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', borderRadius: 11, marginTop: 9, paddingVertical: 13, borderWidth: 1, borderColor: '#a9b5bc' },
  secondaryButtonText: { color: '#17212a', fontSize: 15, fontWeight: '700' },
});
