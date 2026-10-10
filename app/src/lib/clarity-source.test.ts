import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
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

for (const path of ['../../index.html', '../../../landing-astro/src/pages/index.astro']) {
  describe(`deferred Clarity loader: ${path}`, () => {
    for (const trigger of ['pointerdown', 'keydown', 'touchstart', 'scroll', 'timer']) {
      it(`queues immediately and injects only once after ${trigger}`, () => {
        const source = readFileSync(new URL(path, import.meta.url), 'utf8');
        const script = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)].find((match) => match[1].includes('c[a]=c[a]'))?.[1];
        expect(script).toBeDefined();
        const listeners = new Map<string, () => void>();
        const inserted: Array<{ src: string; async: number }> = [];
        let timer: (() => void) | undefined;
        const window = {
          clarity: undefined as unknown as { (...args: unknown[]): void; q: IArguments[] },
          addEventListener: (event: string, handler: () => void, options: unknown) => {
            expect(options).toEqual({ passive: true, once: true });
            listeners.set(event, handler);
          },
          removeEventListener: (event: string) => {
            listeners.delete(event);
          },
        };
        runInNewContext(script!, {
          window,
          document: {
            createElement: () => ({}),
            getElementsByTagName: () => [{ parentNode: { insertBefore: (node: (typeof inserted)[number]) => inserted.push(node) } }],
          },
          setTimeout: (handler: () => void, delay: number) => {
            expect([30000, 90000]).toContain(delay);
            timer = handler;
            return 1;
          },
          clearTimeout: () => {},
        });
        expect(inserted).toHaveLength(0);
        expect(listeners.size).toBe(4);
        expect(Array.from(window.clarity.q[0])).toEqual(['set', 'project_id', 'knowledge-base']);
        window.clarity('set', 'test', 'queued');
        expect(window.clarity.q).toHaveLength(2);
        const fire = trigger === 'timer' ? timer! : listeners.get(trigger)!;
        fire();
        fire();
        timer!();
        expect(inserted).toEqual([{ async: 1, src: 'https://www.clarity.ms/tag/y6btv19tqf' }]);
        expect(listeners.size).toBe(0);
        expect(window.clarity.q).toHaveLength(2);
      });
    }
  });
}
