import { createContext, useContext } from 'react';

import type { AppDataState } from './controller.ts';
import type { Route } from '../../../shared/types.ts';

export type AppDataContextValue = AppDataState & {
  deviceId: string | null;
  registeredEventIds: string[];
  registrationsReady: boolean;
  registerEvent(eventId: string): Promise<number>;
  refresh(): Promise<void>;
  setServerUrl(url: string): Promise<void>;
  getRoute(id: string): Promise<Route | null>;
};

export const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider.');
  return value;
}
