import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERRORS, MfmError, isErrorCode } from '../../../src/cli/errors';
import { dataLines, renderHuman, successEnvelope, useColor } from '../../../src/cli/output';

describe('error codes', () => {
  it('are unique, upper snake case, and each has a message, hint and exit code', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERRORS).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      const info = ERRORS[code];
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(info.message.length, code).toBeGreaterThan(10);
      expect(info.hint.length, code).toBeGreaterThan(10);
      if (info.kind === 'warning') expect(info.exit, code).toBeNull();
      else expect([1, 2, 3, 4, 5], code).toContain(info.exit);
    }
  });

  it('use the exit codes the contract names', () => {
    const expected: Record<string, number> = {
      USAGE: 2,
      NODE_TOO_OLD: 3,
      YTDLP_MISSING: 3,
      CAPTURE_BLOCKED: 1,
      SCHEMA_TOO_NEW: 4,
      PROJECT_TOO_NEW: 4,
      LOCKED: 4,
      PATH_ESCAPES_ROOT: 4,
      APPROVAL_MISSING: 4,
      APPROVAL_STALE: 4,
      CONSENT_MISSING: 4,
      HARD_FAILURES: 4,
      TIMEOUT: 5,
      INTERNAL: 5,
    };
    for (const [code, exit] of Object.entries(expected)) {
      expect(isErrorCode(code), code).toBe(true);
      if (isErrorCode(code)) expect(ERRORS[code].exit, code).toBe(exit);
    }
  });

  it('marks the warning and lab-only codes', () => {
    const kinds = Object.fromEntries(ERROR_CODES.map((code) => [code, ERRORS[code].kind]));
    expect(ERROR_CODES.filter((code) => kinds[code] === 'warning')).toEqual([
      'FONT_LICENCE_UNKNOWN',
      'USER_MOVE_SHADOWED',
      'CAPTURE_TEXT_DROPPED',
    ]);
    expect(ERROR_CODES.filter((code) => kinds[code] === 'lab')).toEqual([
      'SIGNATURE_DUPLICATE',
      'JUDGE_NOT_INDEPENDENT',
      'LAB_PAUSED',
    ]);
  });

  it('MfmError carries defaults that callers can override', () => {
    const plain = new MfmError('DISK_LOW', { freeGb: 1 });
    expect(plain.message).toBe(ERRORS.DISK_LOW.message);
    expect(plain.hint).toBe(ERRORS.DISK_LOW.hint);
    expect(plain.exitCode).toBe(3);
    expect(plain.next).toEqual([]);
    const custom = new MfmError('USAGE', {}, { message: 'm', hint: 'h', next: ['n'] });
    expect([custom.message, custom.hint, custom.next]).toEqual(['m', 'h', ['n']]);
    expect(isErrorCode('NOPE')).toBe(false);
  });
});

describe('output helpers', () => {
  it('flattens data into key lines', () => {
    expect(dataLines({ a: 1, b: { c: null, d: ['x', 'y'] }, e: [], f: [{ g: 1 }] })).toEqual([
      'a: 1',
      'b.c: none',
      'b.d: x, y',
      'e: none',
      'f[0].g: 1',
    ]);
  });

  it('uses colour only on a terminal without NO_COLOR or --no-color', () => {
    const tty = { write: () => true, isTTY: true };
    expect(useColor(false, {}, tty)).toBe(true);
    expect(useColor(true, {}, tty)).toBe(false);
    expect(useColor(false, { NO_COLOR: '1' }, tty)).toBe(false);
    expect(useColor(false, {}, { write: () => true })).toBe(false);
    const coloured = renderHuman(successEnvelope('x', '1.0.0', {}, [{ code: 'USER_MOVE_SHADOWED', message: 'm' }]), { color: true });
    expect(coloured.stderr).toContain('\u001b[33m');
  });
});
