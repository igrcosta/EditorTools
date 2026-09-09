import { useEffect, useState } from 'react';
import type { FeaturesResponse } from '@editools/shared';
import { api } from './api';

const NONE: FeaturesResponse = { removeBackground: false, upscale: false, faceTracking: false };

let cached: FeaturesResponse | null = null;
let inflight: Promise<FeaturesResponse> | null = null;

/**
 * Which desktop-only tools the connected server can run. `null` while loading;
 * fetched once per page load and shared by every caller.
 */
export function useFeatures(): FeaturesResponse | null {
  const [features, setFeatures] = useState<FeaturesResponse | null>(cached);

  useEffect(() => {
    if (cached) return;
    let active = true;
    inflight ??= api.getFeatures().catch(() => NONE);
    void inflight.then((result) => {
      cached = result;
      if (active) setFeatures(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return features;
}
