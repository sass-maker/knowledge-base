import type { Hono } from 'hono';
import type { Variables } from '../auth';
import type { AppRuntime } from '../runtime';
import type { Env, JsonRecord } from '../types';

type App = Hono<{ Bindings: Env; Variables: Variables }>;

export function registerEntityRoutes(app: App, rt: AppRuntime): void {
  const { makeMetadataRepository, relationshipsWithEntityNames } = rt;

  app.get('/v1/kb/entities', async (c) => {
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const domain = c.req.query('domain')?.trim() || undefined;
    const type = c.req.query('type')?.trim() || undefined;
    const limit = Number(c.req.query('limit') ?? 100);
    const entities = await metadataRepo.listEntities(tenant, domain, type, limit);
    return c.json({ project: tenant, domain: domain ?? null, type: type ?? null, entities });
  });

  app.get('/v1/kb/entities/find', async (c) => {
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const domain = c.req.query('domain')?.trim();
    const type = c.req.query('type')?.trim();
    const identityKey = c.req.query('identity_key')?.trim();
    if (!domain) return c.json({ error: 'domain is required' }, 400);
    if (!type) return c.json({ error: 'type is required' }, 400);
    if (!identityKey) return c.json({ error: 'identity_key is required' }, 400);
    const entity = await metadataRepo.findEntity(tenant, domain, type, identityKey);
    if (!entity) return c.json({ error: 'entity not found' }, 404);
    return c.json(entity);
  });

  app.get('/v1/kb/entities/:entity_id', async (c) => {
    const metadataRepo = makeMetadataRepository(c.env);
    const entity = await metadataRepo.getEntity(c.get('tenant'), c.req.param('entity_id'));
    if (!entity) return c.json({ error: 'entity not found' }, 404);
    return c.json(entity);
  });

  app.get('/v1/kb/entities/:entity_id/lineage', async (c) => {
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const entity = await metadataRepo.getEntity(tenant, c.req.param('entity_id'));
    if (!entity) return c.json({ error: 'entity not found' }, 404);
    const lineage = await metadataRepo.getEntityLineage(tenant, entity.id);
    const relationships = await relationshipsWithEntityNames(
      metadataRepo,
      tenant,
      await metadataRepo.listRelationships(tenant, entity.domain, undefined, entity.id, 100),
    );
    return c.json({
      project: tenant,
      entity,
      ...lineage,
      parent_chain: lineage.ancestors.filter((ancestor) => ancestor.id !== entity.id),
      relationships,
    });
  });

  app.get('/v1/kb/entities/:entity_id/relationships', async (c) => {
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const entity = await metadataRepo.getEntity(tenant, c.req.param('entity_id'));
    if (!entity) return c.json({ error: 'entity not found' }, 404);
    const relationships = await relationshipsWithEntityNames(
      metadataRepo,
      tenant,
      await metadataRepo.listRelationships(tenant, entity.domain, undefined, entity.id, 100),
    );
    return c.json({ project: tenant, entity_id: entity.id, relationships });
  });

  app.post('/v1/kb/entities/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { domain?: string; query?: string; limit?: number };
    const domain = body.domain?.trim();
    const query = body.query?.trim();
    if (!domain) return c.json({ error: 'domain is required' }, 400);
    if (!query) return c.json({ error: 'query is required' }, 400);
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const entities = await metadataRepo.searchEntities(tenant, domain, query, body.limit ?? 20);
    return c.json({
      project: tenant,
      domain,
      query,
      route: 'd1_entities',
      ai_used: false,
      entities,
    });
  });

  app.get('/v1/kb/relationships', async (c) => {
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const domain = c.req.query('domain')?.trim() || undefined;
    const relType = c.req.query('type')?.trim() || undefined;
    const entityId = c.req.query('entity_id')?.trim() || undefined;
    const limit = Number(c.req.query('limit') ?? 100);
    const relationships = await relationshipsWithEntityNames(
      metadataRepo,
      tenant,
      await metadataRepo.listRelationships(tenant, domain, relType, entityId, limit),
    );
    return c.json({
      project: tenant,
      domain: domain ?? null,
      type: relType ?? null,
      entity_id: entityId ?? null,
      relationships,
    });
  });

  app.post('/v1/kb/relationships/backfill', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { domain?: string };
    const tenant = c.get('tenant');
    const metadataRepo = makeMetadataRepository(c.env);
    const domain = body.domain?.trim();
    const schemas = (await metadataRepo.listSchemas(tenant)).filter((schema) => !domain || schema.domain === domain);
    if (domain && schemas.length === 0) return c.json({ error: 'active schema not found for domain' }, 404);
    const results = [];
    for (const schema of schemas) {
      results.push(await metadataRepo.backfillEntityRelationships(tenant, schema));
    }
    return c.json({
      project: tenant,
      domain: domain ?? null,
      backfilled_domains: results.length,
      scanned_entities: results.reduce((sum, result) => sum + result.scanned_entities, 0),
      candidate_relationships: results.reduce((sum, result) => sum + result.candidate_relationships, 0),
      relationships_inserted: results.reduce((sum, result) => sum + result.relationships_inserted, 0),
      parent_links_updated: results.reduce((sum, result) => sum + result.parent_links_updated, 0),
      results,
    });
  });
}
