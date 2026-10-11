import { metadataFilterSql } from './metadata-filter';
import type { CreateChunkInput, CreateDocumentInput, CreateIndexInput, LexicalChunkRecord, Repository } from './repository';
import type { ChunkRecord, DocumentRecord, IndexRecord, JsonRecord } from './types';

type StoredDocument = Omit<DocumentRecord, 'metadata'> & { metadata: string };
type StoredChunk = Omit<ChunkRecord, 'metadata'> & { metadata: string };
type StoredLexicalChunk = StoredChunk & { lexical_score: number };

function parseJsonRecord(raw: string | null): JsonRecord {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  } catch {
    return {};
  }
}

function rowToDocument(row: StoredDocument): DocumentRecord {
  return { ...row, metadata: parseJsonRecord(row.metadata) };
}

function rowToChunk(row: StoredChunk): ChunkRecord {
  return { ...row, metadata: parseJsonRecord(row.metadata) };
}

function rowToLexicalChunk(row: StoredLexicalChunk): LexicalChunkRecord {
  return { ...rowToChunk(row), lexical_score: row.lexical_score };
}

function escapeLikeToken(token: string): string {
  return token.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

const currentDocument = "COALESCE(json_extract(metadata, '$._kb_snapshot_state'), 'current') = 'current'";
const currentChunk =
  "EXISTS (SELECT 1 FROM documents d WHERE d.id = c.document_id AND d.tenant = c.tenant AND COALESCE(json_extract(d.metadata, '$._kb_snapshot_state'), 'current') = 'current')";

export class D1Repository implements Repository {
  constructor(
    private readonly db: D1Database,
    private readonly ownedFileReads = false,
  ) {}

  private get documentsTable(): string {
    return this.ownedFileReads ? 'kb_visible_documents' : 'documents';
  }
  private get chunksTable(): string {
    return this.ownedFileReads ? 'kb_visible_chunks' : 'chunks';
  }

  async createIndex(input: CreateIndexInput): Promise<IndexRecord> {
    await this.db
      .prepare(
        `INSERT INTO indexes (id, tenant, name, external_id, dimensions, embedding_model, embedding_provider, metric)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'cosine')`,
      )
      .bind(input.id, input.tenant, input.name, input.externalId, input.dimensions, input.embeddingModel ?? null, input.embeddingProvider ?? null)
      .run();
    const created = await this.getIndex(input.tenant, input.id);
    if (!created) throw new Error('failed to create index');
    return created;
  }

  async listIndexes(tenant: string): Promise<IndexRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, tenant, name, external_id, dimensions, metric, created_at
              , embedding_model, embedding_provider
           FROM indexes
          WHERE tenant = ?
          ORDER BY created_at DESC`,
      )
      .bind(tenant)
      .all<IndexRecord>();
    return result.results ?? [];
  }

  async getIndex(tenant: string, id: string): Promise<IndexRecord | null> {
    return await this.db
      .prepare(
        `SELECT id, tenant, name, external_id, dimensions, metric, created_at
              , embedding_model, embedding_provider
           FROM indexes
          WHERE tenant = ? AND id = ?`,
      )
      .bind(tenant, id)
      .first<IndexRecord>();
  }

  async getIndexRevision(tenant: string, id: string): Promise<number> {
    try {
      const row = await this.db.prepare('SELECT revision FROM kb_index_revisions WHERE tenant=? AND index_id=?').bind(tenant, id).first<{ revision: number }>();
      return row?.revision ?? 0;
    } catch (error) {
      if (!String(error).includes('no such table: kb_index_revisions')) throw error;
      return 0; // Legacy queries remain available before the migration is applied.
    }
  }

  async getIndexByExternalId(tenant: string, externalId: string): Promise<IndexRecord | null> {
    return await this.db
      .prepare(
        `SELECT id, tenant, name, external_id, dimensions, metric, created_at
              , embedding_model, embedding_provider
           FROM indexes
          WHERE tenant = ? AND external_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .bind(tenant, externalId)
      .first<IndexRecord>();
  }

  async deleteIndex(tenant: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM indexes WHERE tenant = ? AND id = ?').bind(tenant, id).run();
  }

  async createDocument(input: CreateDocumentInput): Promise<DocumentRecord> {
    await this.db
      .prepare(
        `INSERT INTO documents (id, index_id, tenant, external_id, content, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.indexId, input.tenant, input.externalId, input.content, JSON.stringify(input.metadata))
      .run();
    const row = await this.db.prepare('SELECT * FROM documents WHERE tenant = ? AND id = ?').bind(input.tenant, input.id).first<StoredDocument>();
    const created = row ? rowToDocument(row) : null;
    if (!created) throw new Error('failed to create document');
    return created;
  }

  async listDocuments(tenant: string, indexId: string, limit: number, offset: number): Promise<DocumentRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT id, index_id, tenant, external_id, content, metadata, created_at
           FROM ${this.documentsTable}
          WHERE tenant = ? AND index_id = ? AND ${currentDocument}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(tenant, indexId, limit, offset)
      .all<StoredDocument>();
    return (result.results ?? []).map(rowToDocument);
  }

  async getDocument(tenant: string, id: string): Promise<DocumentRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT id, index_id, tenant, external_id, content, metadata, created_at
           FROM ${this.documentsTable}
          WHERE tenant = ? AND id = ?`,
      )
      .bind(tenant, id)
      .first<StoredDocument>();
    return row ? rowToDocument(row) : null;
  }

  async getDocumentByExternalId(tenant: string, indexId: string, externalId: string): Promise<DocumentRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM ${this.documentsTable}
      WHERE tenant = ? AND index_id = ? AND external_id = ? AND ${currentDocument}
      ORDER BY created_at DESC, id DESC LIMIT 1`)
      .bind(tenant, indexId, externalId)
      .first<StoredDocument>();
    return row ? rowToDocument(row) : null;
  }

  async getDocumentChunks(tenant: string, documentId: string): Promise<ChunkRecord[]> {
    const rows = await this.db
      .prepare('SELECT * FROM chunks WHERE tenant = ? AND document_id = ? ORDER BY chunk_index')
      .bind(tenant, documentId)
      .all<StoredChunk>();
    return (rows.results ?? []).map(rowToChunk);
  }

  async publishDocumentSnapshot(input: CreateDocumentInput, chunks: CreateChunkInput[], previousId: string | null): Promise<DocumentRecord> {
    if (input.externalId && !(await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_document_current_external'").first())) {
      throw new Error('Catalog snapshot migration 0011 is required before publication');
    }
    const statements: D1PreparedStatement[] = [];
    if (previousId)
      statements.push(
        this.db
          .prepare(`UPDATE documents SET metadata = json_set(metadata, '$._kb_snapshot_state', 'superseded')
      WHERE tenant = ? AND id = ? AND ${currentDocument}`)
          .bind(input.tenant, previousId),
      );
    statements.push(
      this.db
        .prepare(`INSERT INTO documents (id,index_id,tenant,external_id,content,metadata) VALUES (?,?,?,?,?,?)`)
        .bind(input.id, input.indexId, input.tenant, input.externalId, input.content, JSON.stringify(input.metadata)),
    );
    for (const chunk of chunks) statements.push(this.chunkStatement(chunk));
    await this.db.batch(statements);
    const document = await this.getDocument(input.tenant, input.id);
    if (!document) throw new Error('Published snapshot could not be retrieved');
    return document;
  }

  async deleteDocument(tenant: string, id: string): Promise<void> {
    await this.db.prepare('DELETE FROM documents WHERE tenant = ? AND id = ?').bind(tenant, id).run();
  }

  async deleteChunksByIds(tenant: string, ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;
    const placeholders = uniqueIds.map(() => '?').join(',');
    await this.db
      .prepare(`DELETE FROM chunks WHERE tenant = ? AND id IN (${placeholders})`)
      .bind(tenant, ...uniqueIds)
      .run();
  }

  async insertChunks(chunks: CreateChunkInput[]): Promise<void> {
    if (chunks.length === 0) return;
    const statements = chunks.map((chunk) => this.chunkStatement(chunk));
    await this.db.batch(statements);
  }

  private chunkStatement(chunk: CreateChunkInput): D1PreparedStatement {
    return this.db
      .prepare(`INSERT INTO chunks (id,document_id,index_id,tenant,content,chunk_index,metadata)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id,index_id=excluded.index_id,
      tenant=excluded.tenant,content=excluded.content,chunk_index=excluded.chunk_index,metadata=excluded.metadata`)
      .bind(chunk.id, chunk.documentId, chunk.indexId, chunk.tenant, chunk.content, chunk.chunkIndex, JSON.stringify(chunk.metadata));
  }

  async getChunksByIds(tenant: string, ids: string[]): Promise<ChunkRecord[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.db
      .prepare(
        `SELECT c.id, c.document_id, c.index_id, c.tenant, c.content, c.chunk_index, c.metadata, c.created_at
           FROM ${this.chunksTable} c
          WHERE c.tenant = ? AND c.id IN (${placeholders}) AND ${currentChunk}`,
      )
      .bind(tenant, ...ids)
      .all<StoredChunk>();
    return (result.results ?? []).map(rowToChunk);
  }

  async listChunksForIndex(tenant: string, indexId: string, limit: number): Promise<ChunkRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT c.id, c.document_id, c.index_id, c.tenant, c.content, c.chunk_index, c.metadata, c.created_at
           FROM ${this.chunksTable} c
          WHERE c.tenant = ? AND c.index_id = ? AND ${currentChunk}
          ORDER BY chunk_index ASC
          LIMIT ?`,
      )
      .bind(tenant, indexId, limit)
      .all<StoredChunk>();
    return (result.results ?? []).map(rowToChunk);
  }

  async searchLexicalChunks(tenant: string, indexId: string, tokens: string[], limit: number, filter?: JsonRecord): Promise<LexicalChunkRecord[]> {
    if (tokens.length === 0) return [];
    const scoped = metadataFilterSql(filter, 'c.metadata');
    const expression = tokens
      .slice(0, 32)
      .map((token) => `"${token.replaceAll('"', '""')}"*`)
      .join(' OR ');
    try {
      const rows = await this.db
        .prepare(`SELECT c.*, -bm25(chunks_fts) AS lexical_score
        FROM chunks_fts JOIN chunks physical ON physical.rowid=chunks_fts.rowid
        JOIN ${this.chunksTable} c ON c.id=physical.id AND c.tenant=physical.tenant
        JOIN documents d ON d.id=c.document_id AND d.tenant=c.tenant
        WHERE chunks_fts MATCH ? AND c.tenant=? AND c.index_id=?
        AND COALESCE(json_extract(d.metadata,'$._kb_snapshot_state'),'current')='current' AND ${scoped.sql}
        ORDER BY bm25(chunks_fts), c.id LIMIT ?`)
        .bind(expression, tenant, indexId, ...scoped.values, limit)
        .all<StoredLexicalChunk>();
      return (rows.results ?? []).map(rowToLexicalChunk);
    } catch (error) {
      if (!String(error).includes('no such table: chunks_fts')) throw error;
      // Compatibility before migration 0011: SQL still searches the whole corpus.
      console.warn('knowledgebase lexical FTS migration is unavailable; using corpus-wide SQL');
    }
    const patterns = tokens.map((token) => `%${escapeLikeToken(token)}%`);
    const scoreExpr = tokens.map(() => `CASE WHEN LOWER(content) LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`).join(' + ');
    const whereExpr = tokens.map(() => `LOWER(content) LIKE ? ESCAPE '\\'`).join(' OR ');
    const result = await this.db
      .prepare(
        `SELECT c.id, c.document_id, c.index_id, c.tenant, c.content, c.chunk_index, c.metadata, c.created_at,
                (${scoreExpr}) AS lexical_score
           FROM ${this.chunksTable} c
          WHERE c.tenant = ? AND c.index_id = ? AND (${whereExpr}) AND ${currentChunk}
          AND ${scoped.sql}
          ORDER BY lexical_score DESC, chunk_index ASC
          LIMIT ?`,
      )
      .bind(...patterns, tenant, indexId, ...patterns, ...scoped.values, limit)
      .all<StoredLexicalChunk>();
    return (result.results ?? []).map(rowToLexicalChunk);
  }

  async getChunkIdsForDocument(tenant: string, documentId: string): Promise<string[]> {
    const result = await this.db.prepare('SELECT id FROM chunks WHERE tenant = ? AND document_id = ?').bind(tenant, documentId).all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }

  async getChunkIdsForIndex(tenant: string, indexId: string): Promise<string[]> {
    const result = await this.db.prepare('SELECT id FROM chunks WHERE tenant = ? AND index_id = ?').bind(tenant, indexId).all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  }
}
