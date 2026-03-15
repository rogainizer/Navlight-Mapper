import type { LivePosition } from "../types";

export type PositionCallback = (position: LivePosition) => void;
export type ErrorCallback = (message: string) => void;

export function startLocationWatch(
  onPosition: PositionCallback,
  onError: ErrorCallback
): () => void {
  if (!("geolocation" in navigator)) {
    onError("Geolocation is not supported by this browser.");
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      onPosition({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      });
    },
    (error) => {
      onError(error.message || "Unable to read GPS location.");
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    }
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}
