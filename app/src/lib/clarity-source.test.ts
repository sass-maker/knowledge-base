import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser analytics source boundary', () => {
  it('loads the product projects and masks the private application root', () => {
    const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(source).toContain('"y6btv19tqf"');
    expect(source).toContain('window.clarity("set","project_id","knowledge-base")');
    expect(source).toContain('src="https://health.sassmaker.com/tracker.js"');
    expect(source).toContain('data-project="app-cf422c0b-61cc-46b8-abc4-3fc280b0294c"');
    expect(source).toContain('data-key="ahk_pub_fdcb993edf384ecf83fca632a045e016445f2d36253ac9e0915d0076f9f1c159"');
    expect(source).toMatch(/<div id="root" data-clarity-mask="true"><\/div>/u);
  });
});
