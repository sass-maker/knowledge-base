import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';
import { catalogFixture } from './catalog-fixture';

describe('D1 migration SQL compatibility', () => {
  it('keeps CASE expressions parenthesized inside trigger bodies for the remote D1 parser', () => {
    // Remote D1 can misread an unparenthesized CASE END as the trigger END.
    // https://github.com/cloudflare/workers-sdk/issues/4727
    const { sqlite } = catalogFixture('0008_file_artifact_ownership.sql');
    for (const filename of ['0009_file_publication_visibility.sql', '0010_file_dispatch_recovery.sql', '0011_catalog_snapshots_fts_decisions.sql']) {
      const sql = readFileSync(new URL('../migrations/' + filename, import.meta.url), 'utf8');
      const statements = unstable_splitSqlQuery(sql);
      for (const statement of statements) {
        if (/CREATE\s+TRIGGER/i.test(statement)) expect(statement).not.toMatch(/SELECT\s+CASE\b/i);
        sqlite.exec(statement);
      }
    }
    expect(() => sqlite.exec("INSERT INTO kb_file_publications(operation_id,project,file_id,generation) VALUES('unknown','tenant','file',1)")).toThrow(
      'file_operation_not_publishable',
    );
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='chunks_fts'").get()).toMatchObject({ n: 1 });
    sqlite.close();
  });
});
