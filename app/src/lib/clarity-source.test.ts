import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Clarity source boundary', () => {
  it('loads the product project and masks the private application root', () => {
    const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(source).toContain('"y6btv19tqf"');
    expect(source).toContain('window.clarity("set","project_id","knowledge-base")');
    expect(source).toMatch(/<div id="root" data-clarity-mask="true"><\/div>/u);
  });
});
