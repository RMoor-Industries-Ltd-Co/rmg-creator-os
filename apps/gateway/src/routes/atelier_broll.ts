// apps/gateway/src/routes/atelier_broll.ts
// Atelier B-Roll — scene-based AI video generation with optional Rahm image reference.
// Distinct from stock b-roll (Pexels/Pixabay); uses Higgsfield/SuperCool/Canva providers.

import type { FastifyInstance } from 'fastify';
import { eq } from '@rmg-creator-os/db';
import { tables, enqueueJob } from '@rmg-creator-os/db';
import type { Database } from '@rmg-creator-os/db';
import { randomUUID } from 'node:crypto';

type Scene = {
  id: string;
  description: string;
  refIds: string[];
  providers: string[];
  takes: Take[];
  approvedIds: string[];
};

type Take = {
  id: string;
  provider: string;
  jobId: string;
  driveId: string | null;
  status: 'queued' | 'done' | 'failed';
  label: string;
};

function parseScenes(raw: unknown): Scene[] {
  return Array.isArray(raw) ? (raw as Scene[]) : [];
}

export function registerAtelierBrollRoutes(app: FastifyInstance, db: Database) {
  // GET /productions/:id/broll — scene list + library
  app.get<{ Params: { id: string } }>('/productions/:id/broll', async (request, reply) => {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });
    return { scenes: parseScenes(prod.brollScenes), library: prod.brollLibrary ?? [] };
  });

  // POST /productions/:id/broll/scenes — add a scene
  app.post<{ Params: { id: string }; Body: { description: string; refIds?: string[]; providers?: string[] } }>(
    '/productions/:id/broll/scenes',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes);
      const scene: Scene = {
        id: randomUUID(),
        description: request.body.description,
        refIds: request.body.refIds ?? [],
        providers: request.body.providers ?? [],
        takes: [],
        approvedIds: [],
      };
      scenes.push(scene);
      await db.update(tables.productions).set({ brollScenes: scenes as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(tables.productions.id, prod.id));
      return reply.code(201).send({ scene });
    }
  );

  // PATCH /productions/:id/broll/scenes/:sid — update prompt / refs / providers
  app.patch<{ Params: { id: string; sid: string }; Body: { description?: string; refIds?: string[]; providers?: string[] } }>(
    '/productions/:id/broll/scenes/:sid',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes);
      const idx = scenes.findIndex((s) => s.id === request.params.sid);
      if (idx === -1) return reply.code(404).send({ error: 'scene not found' });
      const { description, refIds, providers } = request.body ?? {};
      if (description !== undefined) scenes[idx].description = description;
      if (refIds !== undefined)      scenes[idx].refIds = refIds;
      if (providers !== undefined)   scenes[idx].providers = providers;
      await db.update(tables.productions).set({ brollScenes: scenes as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(tables.productions.id, prod.id));
      return { scene: scenes[idx] };
    }
  );

  // DELETE /productions/:id/broll/scenes/:sid — remove a scene
  app.delete<{ Params: { id: string; sid: string } }>(
    '/productions/:id/broll/scenes/:sid',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes).filter((s) => s.id !== request.params.sid);
      await db.update(tables.productions).set({ brollScenes: scenes as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(tables.productions.id, prod.id));
      return reply.code(204).send();
    }
  );

  // POST /productions/:id/broll/scenes/:sid/render — enqueue renders for a scene
  app.post<{ Params: { id: string; sid: string } }>(
    '/productions/:id/broll/scenes/:sid/render',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes);
      const scene = scenes.find((s) => s.id === request.params.sid);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });

      const jobs = [];
      for (const provider of scene.providers) {
        const job = await enqueueJob(db, {
          productionId: prod.id,
          capability: 'broll',
          provider,
          payload: { sceneId: scene.id, description: scene.description, refIds: scene.refIds },
        });
        const take: Take = { id: randomUUID(), provider, jobId: job.id, driveId: null, status: 'queued', label: `${scene.description.slice(0, 30)} — ${provider}` };
        scene.takes.push(take);
        jobs.push({ jobId: job.id, provider, takeId: take.id });
      }

      await db.update(tables.productions).set({ brollScenes: scenes as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(tables.productions.id, prod.id));
      return reply.code(201).send({ jobs });
    }
  );

  // POST /productions/:id/broll/takes/:tid/approve — add take to B-Roll library
  app.post<{ Params: { id: string; tid: string }; Body: { drive_id: string; label?: string } }>(
    '/productions/:id/broll/takes/:tid/approve',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes);
      let approved = false;
      for (const scene of scenes) {
        const take = scene.takes.find((t) => t.id === request.params.tid);
        if (take) {
          if (!scene.approvedIds.includes(take.id)) scene.approvedIds.push(take.id);
          approved = true;
        }
      }
      if (!approved) return reply.code(404).send({ error: 'take not found' });

      const library = Array.isArray(prod.brollLibrary) ? [...(prod.brollLibrary as Record<string, unknown>[])] : [];
      library.push({ driveId: request.body.drive_id, takeId: request.params.tid, label: request.body.label ?? '' });

      await db.update(tables.productions)
        .set({ brollScenes: scenes as unknown as Record<string, unknown>[], brollLibrary: library, updatedAt: new Date() })
        .where(eq(tables.productions.id, prod.id));
      return { library };
    }
  );

  // DELETE /productions/:id/broll/takes/:tid — discard a take
  app.delete<{ Params: { id: string; tid: string } }>(
    '/productions/:id/broll/takes/:tid',
    async (request, reply) => {
      const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
      if (!prod) return reply.code(404).send({ error: 'production not found' });
      const scenes = parseScenes(prod.brollScenes);
      for (const scene of scenes) {
        scene.takes = scene.takes.filter((t) => t.id !== request.params.tid);
        scene.approvedIds = scene.approvedIds.filter((id) => id !== request.params.tid);
      }
      await db.update(tables.productions).set({ brollScenes: scenes as unknown as Record<string, unknown>[], updatedAt: new Date() }).where(eq(tables.productions.id, prod.id));
      return reply.code(204).send();
    }
  );

  // GET /productions/:id/broll/download — Drive URLs for approved clips
  app.get<{ Params: { id: string } }>('/productions/:id/broll/download', async (request, reply) => {
    const [prod] = await db.select().from(tables.productions).where(eq(tables.productions.id, request.params.id));
    if (!prod) return reply.code(404).send({ error: 'production not found' });
    const library = (prod.brollLibrary ?? []) as Array<{ driveId: string; label: string }>;
    return {
      clips: library.map((c, i) => ({
        name: `broll-scene${i + 1}-${c.label.replace(/\s+/g, '_').slice(0, 30)}.mp4`,
        driveId: c.driveId,
        driveUrl: `https://drive.google.com/file/d/${c.driveId}/view`,
      })),
    };
  });
}
