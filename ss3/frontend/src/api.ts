// Thin fetch client. In dev, Vite proxies these paths to the FastAPI
// backend (see vite.config.ts). In production, the backend serves the
// built frontend so same-origin requests work directly.

import type { Report, SessionMetadata, PrecheckResult } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const data = await getJson<{ sessions: SessionMetadata[] }>('/sessions');
  return data.sessions ?? [];
}

export async function getStatus(
  id: string,
): Promise<{ state: string; error: string | null }> {
  return getJson('/sessions/' + id + '/status');
}

export async function getReport(id: string): Promise<Report> {
  return getJson<Report>('/sessions/' + id + '/report');
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch('/sessions/' + id, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Delete failed: ' + res.status);
  }
}

export async function uploadRecording(blob: Blob): Promise<{ session_id: string }> {
  const fd = new FormData();
  fd.append('video', blob, 'recording.webm');
  const res = await fetch('/sessions', { method: 'POST', body: fd });
  if (!res.ok) {
    throw new Error('Upload failed: ' + res.status);
  }
  return res.json();
}

export async function precheck(frame: Blob): Promise<PrecheckResult> {
  const fd = new FormData();
  fd.append('frame', frame, 'frame.jpg');
  const res = await fetch('/precheck', { method: 'POST', body: fd });
  if (!res.ok) {
    return { pose_ok: false, face_ok: false };
  }
  return res.json();
}
