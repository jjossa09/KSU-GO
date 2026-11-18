import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Route } from '../../../shared/types.ts';
import { useAppData } from '../../src/data/AppDataContext';
import { ViewerWebView } from '../../src/viewer/ViewerWebView';
import { viewerHtml } from '../../src/viewerHtml';

export default function RouteScreen() {
  const { routeId } = useLocalSearchParams<{ routeId?: string }>();
  const { getRoute } = useAppData();
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRoute(null);
    setError(null);
    if (!routeId) return () => { active = false; };

    void getRoute(routeId).then((value) => {
      if (!active) return;
      if (!value || value.status !== 'confirmed') {
        setError('A confirmed route is not available for this event.');
        return;
      }
      setRoute(value);
    }).catch(() => {
      if (active) setError('The route could not be loaded.');
    });

    return () => { active = false; };
  }, [getRoute, routeId]);

  const initialMessage = useMemo(() => route ? ({ type: 'route:load' as const, route }) : undefined, [route]);

  return (
    <View style={styles.container}>
      {!routeId ? (
        <View style={styles.message}>
          <Text style={styles.title}>Route</Text>
          <Text style={styles.body}>Choose an event with a confirmed route to view directions.</Text>
        </View>
      ) : error ? (
        <View style={styles.message}>
          <Text style={styles.title}>Route</Text>
          <Text accessibilityRole="alert" style={styles.body}>{error}</Text>
        </View>
      ) : route ? (
        <ViewerWebView
          source={{ html: viewerHtml }}
          initialMessage={initialMessage}
          onMessage={() => {}}
        />
      ) : (
        <View style={styles.message}>
          <Text style={styles.title}>Loading route…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101820' },
  message: { flex: 1, padding: 24, backgroundColor: '#f5f7f8' },
  title: { color: '#17212a', fontSize: 24, fontWeight: '700' },
  body: { color: '#53616c', marginTop: 8, fontSize: 15 },
});
