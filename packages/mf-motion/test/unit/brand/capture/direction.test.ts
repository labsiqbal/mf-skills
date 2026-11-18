// brand.md keeps the direction of right-to-left lines (MFM-021).
import { describe, expect, it } from 'vitest';
import { directedLine, rtlTexts } from '../../../../src/brand/index';

const PAGE = `<!doctype html><html lang="en"><body>
<h1>Slow stories for fast times.</h1>
<p class="ar" dir="rtl" lang="ar">قصص هادئة
  لزمن سريع</p>
<section dir="RTL"><p>نص <b>عربي</b> آخر</p><p dir="ltr">Left inside right</p></section>
<script dir="rtl">var hidden = 1;</script>
</body></html>`;

describe('right-to-left lines', () => {
  it('collects the text of elements whose own or inherited dir is rtl', () => {
    expect([...rtlTexts(PAGE)]).toEqual(['قصص هادئة لزمن سريع', 'نص عربي آخر']);
  });

  it('marks right-to-left lines with dir="rtl" and leaves left-to-right lines unchanged', () => {
    const rtl = rtlTexts(PAGE);
    expect(directedLine('قصص هادئة لزمن سريع', rtl)).toBe('[dir="rtl"] قصص هادئة لزمن سريع');
    expect(directedLine('Slow stories for fast times.', rtl)).toBe('Slow stories for fast times.');
    expect(directedLine('Left inside right', rtl)).toBe('Left inside right');
    expect(directedLine('```', new Set())).not.toContain('```');
  });
});
