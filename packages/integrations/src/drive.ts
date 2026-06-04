// Minimal Google Drive uploader using an OAuth refresh token (reuses the rclone
// Drive credentials). Enough to download a URL and upload it into a folder.

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink?: string;
}

export interface DriveDownload {
  bytes: Buffer;
  mimeType: string;
}

export interface DriveClient {
  uploadFromUrl(opts: {
    url: string;
    name: string;
    folderId: string;
    mimeType?: string;
  }): Promise<DriveUploadResult>;
  uploadBuffer(opts: {
    bytes: Buffer;
    name: string;
    folderId: string;
    mimeType?: string;
  }): Promise<DriveUploadResult>;
  download(fileId: string): Promise<DriveDownload>;
  deleteFile(fileId: string): Promise<void>;
  listFolder(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>>;
  readText(fileId: string, mimeType: string): Promise<string>;
  createFolder(name: string, parentId: string): Promise<string>;
  updateFile(
    fileId: string,
    opts: { name?: string; description?: string; addParents?: string; removeParents?: string }
  ): Promise<{ fileId: string; webViewLink?: string }>;
}

export function createDriveClient(cfg: DriveConfig): DriveClient {
  let accessToken: string | null = null;
  let expiresAt = 0;

  async function getToken(): Promise<string> {
    if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token'
      })
    });
    if (!res.ok) throw new Error(`Drive token refresh failed (${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    accessToken = j.access_token;
    expiresAt = Date.now() + j.expires_in * 1000;
    return accessToken;
  }

  async function uploadBytes(
    bytes: Buffer,
    name: string,
    folderId: string,
    contentType: string
  ): Promise<DriveUploadResult> {
    const token = await getToken();
    const boundary = `rmgdrive${bytes.length.toString(36)}xyz`;
    const metadata = JSON.stringify({ name, parents: [folderId] });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    const up = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      }
    );
    if (!up.ok) throw new Error(`Drive upload failed (${up.status}): ${await up.text()}`);
    const r = (await up.json()) as { id: string; webViewLink?: string };
    return { fileId: r.id, webViewLink: r.webViewLink };
  }

  return {
    async uploadFromUrl({ url, name, folderId, mimeType }) {
      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`source download failed (${dl.status})`);
      const bytes = Buffer.from(await dl.arrayBuffer());
      const contentType = mimeType ?? dl.headers.get('content-type') ?? 'application/octet-stream';
      return uploadBytes(bytes, name, folderId, contentType);
    },

    async uploadBuffer({ bytes, name, folderId, mimeType }) {
      return uploadBytes(bytes, name, folderId, mimeType ?? 'application/octet-stream');
    },

    async download(fileId) {
      const token = await getToken();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream'
      };
    },

    async deleteFile(fileId) {
      const token = await getToken();
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Drive delete failed (${res.status})`);
      }
    },

    async listFolder(folderId) {
      const token = await getToken();
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
      const j = (await res.json()) as { files?: Array<{ id: string; name: string; mimeType: string }> };
      return j.files ?? [];
    },

    async readText(fileId, mimeType) {
      const token = await getToken();
      // Google Docs must be exported; plain files download directly.
      const url =
        mimeType === 'application/vnd.google-apps.document'
          ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&supportsAllDrives=true`
          : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Drive read failed (${res.status})`);
      return (await res.text()).replace(/^﻿/, '').trim();
    },

    async createFolder(name, parentId) {
      const token = await getToken();
      const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
      });
      if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`);
      return ((await res.json()) as { id: string }).id;
    },

    async updateFile(fileId, opts) {
      const token = await getToken();
      const params = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,webViewLink' });
      if (opts.addParents) params.set('addParents', opts.addParents);
      if (opts.removeParents) params.set('removeParents', opts.removeParents);
      const body: Record<string, string> = {};
      if (opts.name) body.name = opts.name;
      if (opts.description !== undefined) body.description = opts.description;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${params}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`Drive update failed (${res.status})`);
      const r = (await res.json()) as { id: string; webViewLink?: string };
      return { fileId: r.id, webViewLink: r.webViewLink };
    }
  };
}
