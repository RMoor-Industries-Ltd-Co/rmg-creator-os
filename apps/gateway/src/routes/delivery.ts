// apps/gateway/src/routes/delivery.ts
// Ad Index issuance, My Poster approval, Final Cut re-upload, download package ZIP.

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from '@rmg-creator-os/db';
import { tables } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';
import type { MultipartFile } from '@fastify/multipart';

// Drive folder IDs from env (all in rahm@rmasters.group)
const ATELIER_FINAL_FOLDER    = process.env.ATELIER_FINAL_FOLDER_ID    ?? '';
const ATELIER_APPROVED_FOLDER = process.env.ATELIER_THUMBNAIL_APPROVED_ID ?? '';
const ATELIER_ARCHIVED_FOLDER = process.env.ATELIER_THUMBNAIL_ARCHIVED_ID ?? '';

type DriveClient = {
  upload: (opts: { name: string; bytes: Buffer; mimeType: string; folderId: string }) => Promise<{ id: string; webViewLink?: string }>;
  move:   (fileId: string, newFolderId: string) => Promise<void>;
  download: (fileId: string) => Promise<{ bytes: Buffer }>;
  signedUrl?: (fileId: string) => Promise<string>;
};

export function registerDeliveryRoutes(app: FastifyInstance, db: Database, drive: DriveClient | null) {
  // ── Ad Index ──────────────────────────────────────────────────────────────

  // GET /ad-index — browse all codes
  app.get<{ Querystring: { type?: string; product?: string; region?: string; status?: string; production_id?: string } }>(
    '/ad-index',
    async (request) => {
      const { type, product, region, status, production_id } = request.query;
      const conditions = [];
      if (type)          conditions.push(eq(tables.adIndex.type, type));
      if (product)       conditions.push(eq(tables.adIndex.product, product));
      if (region)        conditions.push(eq(tables.adIndex.region, region));
      if (status)        conditions.push(eq(tables.adIndex.status, status as 'draft' | 'approved' | 'published' | 'archived'));
      if (production_id) conditions.push(eq(tables.adIndex.productionId, production_id));
      const rows = conditions.length
        ? await db.select().from(tables.adIndex).where(and(...conditions)).orderBy(desc(tables.adIndex.createdAt))
        : await db.select().from(tables.adIndex).orderBy(desc(tables.adIndex.createdAt));
      return { codes: rows };
    }
  );

  // GET /ad-index/:code — single code detail
  app.get<{ Params: { code: string } }>('/ad-index/:code', async (request, reply) => {
    const [row] = await db.select().from(tables.adIndex).where(eq(tables.adIndex.code, request.params.code));
    if (!row) return reply.code(404).send({ error: 'code not found' });
    return { code: row };
  });

  // POST /ad-index/issue — assign a new code to a production
  app.post<{ Body: { production_id: string; type: string; product: string; region: string; tz: string } }>(
    '/ad-index/issue',
    async (request, reply) => {
      const { production_id, type, product, region, tz } = request.body ?? {};
      if (!production_id || !type || !product || !region || !tz) {
        return reply.code(400).send({ error: 'production_id, type, product, region, tz are required' });
      }
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, production_id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });

      // Find the current max version for this slot
      const [max] = await db
        .select({ v: sql<number>`coalesce(max(${tables.adIndex.version}), 0)` })
        .from(tables.adIndex)
        .where(
          and(
            eq(tables.adIndex.type, type),
            eq(tables.adIndex.product, product),
            eq(tables.adIndex.region, region),
            eq(tables.adIndex.tz, tz)
          )
        );
      const version = (max?.v ?? 0) + 1;
      const code = `${type}-${product}-${region}-${tz}-${String(version).padStart(3, '0')}`;

      const [row] = await db
        .insert(tables.adIndex)
        .values({ code, type, product, region, tz, version, productionId: production_id })
        .returning();

      // Attach code to the production
      await db.update(tables.productions).set({ adIndexCode: code, updatedAt: new Date() }).where(eq(tables.productions.id, production_id));

      return reply.code(201).send({ code: row });
    }
  );

  // ── My Poster approval ────────────────────────────────────────────────────

  // POST /productions/:id/poster/approve — approve a My Poster candidate
  app.post<{
    Params: { id: string };
    Body: { asset_id?: string; drive_file_id?: string; issue_ad_index?: { type: string; product: string; region: string; tz: string } };
  }>('/productions/:id/poster/approve', async (request, reply) => {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });

    const { asset_id, drive_file_id, issue_ad_index } = request.body ?? {};
    let posterDriveId = drive_file_id ?? '';

    // If a Drive file is already stored, move it to APPROVED folder
    if (posterDriveId && drive && ATELIER_APPROVED_FOLDER) {
      // Move any existing approved poster to ARCHIVED first
      if (prod.thumbnailDriveId && ATELIER_ARCHIVED_FOLDER) {
        try { await drive.move(prod.thumbnailDriveId, ATELIER_ARCHIVED_FOLDER); } catch { /* best effort */ }
      }
      await drive.move(posterDriveId, ATELIER_APPROVED_FOLDER);
    }

    // If no code yet, optionally issue one
    let adIndexCode = prod.adIndexCode;
    if (!adIndexCode && issue_ad_index) {
      const { type, product, region, tz } = issue_ad_index;
      const [max] = await db
        .select({ v: sql<number>`coalesce(max(${tables.adIndex.version}), 0)` })
        .from(tables.adIndex)
        .where(and(eq(tables.adIndex.type, type), eq(tables.adIndex.product, product), eq(tables.adIndex.region, region), eq(tables.adIndex.tz, tz)));
      const version = (max?.v ?? 0) + 1;
      adIndexCode = `${type}-${product}-${region}-${tz}-${String(version).padStart(3, '0')}`;
      await db.insert(tables.adIndex).values({ code: adIndexCode, type, product, region, tz, version, productionId: prod.id, status: 'approved', approvedAt: new Date() });
    } else if (adIndexCode) {
      await db.update(tables.adIndex).set({ status: 'approved', posterDriveId, approvedAt: new Date() }).where(eq(tables.adIndex.code, adIndexCode));
    }

    const [updated] = await db
      .update(tables.productions)
      .set({ thumbnailDriveId: posterDriveId || prod.thumbnailDriveId, adIndexCode: adIndexCode ?? prod.adIndexCode, updatedAt: new Date() })
      .where(eq(tables.productions.id, prod.id))
      .returning();

    return { production: updated, adIndexCode };
  });

  // ── Final Cut ─────────────────────────────────────────────────────────────

  // POST /productions/:id/final-cut — re-upload the CapCut-edited final video
  app.post<{ Params: { id: string } }>('/productions/:id/final-cut', async (request, reply) => {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });
    if (!drive || !ATELIER_FINAL_FOLDER) {
      return reply.code(503).send({ error: 'Drive not configured for final cut upload' });
    }

    let file: MultipartFile | undefined;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: 'multipart file required' });
    }
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });

    const code = prod.adIndexCode ?? prod.id;
    const ext = file.filename.split('.').pop() ?? 'mp4';
    const name = `${code}.${ext}`;
    const bytes = await file.toBuffer();

    const saved = await drive.upload({ name, bytes, mimeType: file.mimetype, folderId: ATELIER_FINAL_FOLDER });

    // Update ad_index if code exists
    if (prod.adIndexCode) {
      await db.update(tables.adIndex).set({ finalDriveId: saved.id }).where(eq(tables.adIndex.code, prod.adIndexCode));
    }

    const [updated] = await db
      .update(tables.productions)
      .set({ finalVideoId: saved.id, stage: 'complete', updatedAt: new Date() })
      .where(eq(tables.productions.id, prod.id))
      .returning();

    return reply.code(201).send({ production: updated, driveId: saved.id, driveUrl: saved.webViewLink, adIndexCode: prod.adIndexCode });
  });

  // GET /productions/:id/final-cut/download — download package (A-Roll, B-Roll, poster, caption)
  app.get<{ Params: { id: string } }>('/productions/:id/final-cut/download', async (request, reply) => {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });

    const videos = await db.select().from(tables.videos).where(eq(tables.videos.productionId, prod.id));
    const posts  = await db.select().from(tables.posts).where(eq(tables.posts.productionId, prod.id));

    const aroll = videos.find((v) => v.source === 'heygen' && (v.config as Record<string, unknown>)?.aroll && v.status === 'completed');
    const brollLibrary = (prod.brollLibrary ?? []) as Array<{ driveId: string; label: string }>;

    const caption = posts[0]?.caption ?? '';
    const hashtags = (posts[0]?.hashtags ?? []).join(' ');

    return {
      productionId: prod.id,
      adIndexCode: prod.adIndexCode ?? null,
      assets: {
        aroll: aroll ? { driveId: aroll.driveFileId, url: aroll.driveLink, name: `${prod.adIndexCode ?? prod.id}-aroll.mp4` } : null,
        broll: brollLibrary.map((b, i) => ({ driveId: b.driveId, label: b.label, name: `broll-scene${i + 1}.mp4` })),
        poster: prod.thumbnailDriveId ? { driveId: prod.thumbnailDriveId } : null,
      },
      caption: `${caption}\n\n${hashtags}`.trim(),
    };
  });
}
