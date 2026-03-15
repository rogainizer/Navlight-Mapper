export interface SyncBatchResponse {
  batchId: string;
  syncedPointIds: string[];
  syncedPhotoIds: string[];
  failedPhotoIds: string[];
}

interface ApiErrorBody {
  message?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export async function uploadSyncBatch(formData: FormData): Promise<SyncBatchResponse> {
  const response = await fetch(`${API_BASE_URL}/sync/batch`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Sync request failed.");
  }

  return (await response.json()) as SyncBatchResponse;
}

export async function fetchMapBlobFromUrl(url: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/maps/fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    let message = "Map download failed.";
    try {
      const errorBody = (await response.json()) as ApiErrorBody;
      if (errorBody.message) {
        message = errorBody.message;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return response.blob();
}
