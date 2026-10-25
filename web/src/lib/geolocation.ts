/**
 * Optional location capture.
 *
 * Location is never required. It is requested only when the user asks for it,
 * at the moment they save, and every failure degrades to "saved without
 * location" with a reason the UI can show — never to a blocked save.
 */

import type { GeoLocation } from "@/types";

const PREF_KEY = "breedvision.attachLocation";
const TIMEOUT_MS = 10_000;

/** Remembered choice. Defaults to off: location is opt-in. */
export function getLocationPreference(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLocationPreference(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked (private mode): the choice just isn't remembered */
  }
}

export type LocationResult =
  | { ok: true; location: GeoLocation }
  | { ok: false; reason: string };

/** Message says what happened and what the user can do about it. */
function describe(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission was denied, so the record was saved without it. You can allow location in your browser settings.";
    case err.POSITION_UNAVAILABLE:
      return "This device could not work out its position, so the record was saved without location.";
    case err.TIMEOUT:
      return "Finding your location took too long, so the record was saved without it.";
    default:
      return "Location could not be read, so the record was saved without it.";
  }
}

export function captureLocation(): Promise<LocationResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({
      ok: false,
      reason: "This browser does not support location, so the record was saved without it.",
    });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          location: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy)
              ? Math.round(pos.coords.accuracy)
              : null,
          },
        }),
      (err) => resolve({ ok: false, reason: describe(err) }),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 30_000 },
    );
  });
}
