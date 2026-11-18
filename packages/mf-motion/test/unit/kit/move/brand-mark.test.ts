import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveCtx } from '../../../../src/kit/build/move';
import { brandFor, resolveBrandMark } from '../../../../src/moves/build';

const brand = brandFor('', 'demo:tessarine');
const input = { aspect: '16:9', mode: 'full', layer: 'broll', brand: brand.doc as never, seed: 1, durationSec: 4 } as const;

describe('picked brand artwork in the move context', () => {
  it('stages a different mark from each demo brand', () => {
    const hashes = ['tessarine', 'mossmallow', 'quillfen'].map((id) => {
      const picked = brandFor('', `demo:${id}`);
      const ctx = moveCtx({ ...input, brandMark: resolveBrandMark(picked) });
      expect(ctx.brandMark).toEqual({ file: 'assets/brand/mark.svg', kind: 'mark', width: 80, height: 80 });
      expect(ctx.assets.requests).toHaveLength(1);
      return createHash('sha256').update(readFileSync(ctx.assets.requests[0]!.from)).digest('hex');
    });
    expect(new Set(hashes).size).toBe(3);
  });

  it('accepts a picked PNG and uses a logo when no mark was picked', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mfm-picked-mark-'));
    try {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVHsAAAAASUVORK5CYII=', 'base64');
      writeFileSync(path.join(dir, 'picked.png'), png);
      const picked = moveCtx({ ...input, brandMark: resolveBrandMark({ dir, doc: { mark: { path: 'picked.png', kind: 'png', w: 1, h: 1 } } }) });
      expect(picked.brandMark).toEqual({ file: 'assets/brand/mark.png', kind: 'mark', width: 1, height: 1 });
      expect(readFileSync(picked.assets.requests[0]!.from)).toEqual(png);
      const logo = moveCtx({ ...input, brandMark: resolveBrandMark({ ...brand, doc: { ...brand.doc, mark: null } }) });
      expect(logo.brandMark).toEqual({ file: 'assets/brand/logo.svg', kind: 'logo', width: 459, height: 80 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no asset without a resolved mark and refuses unavailable selections', () => {
    const escaped = { path: '../quillfen/mark.svg', kind: 'svg', w: 80, h: 80 };
    const video = { path: 'mark.mp4', kind: 'mp4', w: 80, h: 80 };
    expect(moveCtx(input).brandMark).toBeNull();
    expect(resolveBrandMark({ ...brand, doc: { ...brand.doc, mark: escaped } })).toBeNull();
    expect(resolveBrandMark({ ...brand, doc: { ...brand.doc, mark: video } })).toBeNull();
  });
});
