import { useSyncExternalStore } from 'react';
import { localDay, watchLocalDay } from './local-day.js';

export default function useLocalDay() {
  return useSyncExternalStore(watchLocalDay, localDay, localDay);
}
