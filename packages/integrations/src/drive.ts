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

export interface DriveClient {
  uploadFromUrl(opts: {
    url: string;
    name: string;
    folderId: string;
    mimeType?: string;
  }): Promise<DriveUploadResult>;
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

  return {
    async uploadFromUrl({ url, name, folderId, mimeType }) {
      const token = await getToken();

      const dl = await fetch(url);
      if (!dl.ok) throw new Error(`source download failed (${dl.status})`);
      const bytes = Buffer.from(await dl.arrayBuffer());
      const contentType = mimeType ?? dl.headers.get('content-type') ?? 'application/octet-stream';

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
  };
}
