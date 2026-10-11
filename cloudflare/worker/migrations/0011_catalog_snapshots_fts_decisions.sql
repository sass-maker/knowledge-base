-- Catalog snapshots opt into the protocol with explicit current state.
-- Preserve legacy documents and duplicate external IDs without backfill.

CREATE UNIQUE INDEX idx_document_current_external
ON documents(tenant,index_id,external_id)
WHERE external_id IS NOT NULL AND json_extract(metadata,'$._kb_snapshot_state')='current';

CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content='chunks', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid,content) VALUES(new.rowid,new.content);
END;
CREATE TRIGGER chunks_fts_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts,rowid,content) VALUES('delete',old.rowid,old.content);
END;
CREATE TRIGGER chunks_fts_update AFTER UPDATE OF content ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts,rowid,content) VALUES('delete',old.rowid,old.content);
  INSERT INTO chunks_fts(rowid,content) VALUES(new.rowid,new.content);
END;
INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');

CREATE TABLE kb_index_revisions (
  tenant TEXT NOT NULL,
  index_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(tenant,index_id)
);
CREATE TRIGGER catalog_document_insert AFTER INSERT ON documents BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(new.tenant,new.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER catalog_document_update AFTER UPDATE ON documents BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(new.tenant,new.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER catalog_document_delete AFTER DELETE ON documents BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(old.tenant,old.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER catalog_chunk_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(new.tenant,new.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER catalog_chunk_update AFTER UPDATE ON chunks BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(new.tenant,new.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER catalog_chunk_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO kb_index_revisions(tenant,index_id,revision) VALUES(old.tenant,old.index_id,1)
  ON CONFLICT(tenant,index_id) DO UPDATE SET revision=revision+1;
END;

CREATE TABLE kb_decision_runs (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  index_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  frozen_input TEXT NOT NULL,
  engines TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX idx_decision_runs_tenant ON kb_decision_runs(tenant,index_id,created_at DESC);
