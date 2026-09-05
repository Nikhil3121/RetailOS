/**
 * Navigation and external-open guards.
 *
 * `shell.openExternal` asks the OPERATING SYSTEM to open a URL. Before this
 * module existed, both the window-open handler and the will-navigate handler
 * passed whatever URL they were given straight to it, which turns any link the
 * renderer can be made to follow into "run the program Windows has registered
 * for that scheme".
 *
 * These tests are the reason that cannot come back.
 */

import { describe, expect, it } from 'vitest';

import { isInternalUrl, isSafeExternalUrl, schemeOf } from '../navigation';

const DEV = 'http://localhost:5273';

describe('isSafeExternalUrl', () => {
  it('allows the schemes a link is legitimately for', () => {
    expect(isSafeExternalUrl('https://zoho.com/pos')).toBe(true);
    expect(isSafeExternalUrl('http://192.168.1.20:8000/docs')).toBe(true);
    expect(isSafeExternalUrl('mailto:owner@msmall.example')).toBe(true);
  });

  it('refuses file:// — the OS would launch the file, not display it', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isSafeExternalUrl('file:///tmp/payload.exe')).toBe(false);
  });

  it('refuses OS protocol handlers used for code execution', () => {
    // Both of these have been used in real attacks to get code execution from
    // nothing more than a crafted link.
    expect(isSafeExternalUrl('ms-msdt:/id PCWDiagnostic')).toBe(false);
    expect(isSafeExternalUrl('search-ms:query=x&crumb=location:\\\\evil')).toBe(false);
    expect(isSafeExternalUrl('ms-officecmd:{"id":3}')).toBe(false);
    expect(isSafeExternalUrl('vscode://file/etc/passwd')).toBe(false);
  });

  it('refuses script and data URLs', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('refuses anything it cannot parse, rather than guessing', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl('///')).toBe(false);
  });

  it('is an allow-list, so an unknown scheme is refused by default', () => {
    expect(isSafeExternalUrl('someneverbeforeseen://payload')).toBe(false);
  });
});

describe('isInternalUrl', () => {
  it('accepts the dev server and the packaged renderer', () => {
    expect(isInternalUrl('http://localhost:5273/billing', DEV)).toBe(true);
    expect(isInternalUrl('file:///C:/Program%20Files/RetailOS/dist/index.html', DEV)).toBe(true);
  });

  it('rejects a host that merely STARTS WITH the dev server URL', () => {
    // The previous check used startsWith, which this passes: a different
    // origin entirely, treated as internal and allowed to navigate.
    expect(isInternalUrl('http://localhost:5273.evil.com/steal', DEV)).toBe(false);
    expect(isInternalUrl('http://localhost:52730/', DEV)).toBe(false);
  });

  it('rejects a different port on the same host', () => {
    expect(isInternalUrl('http://localhost:8000/', DEV)).toBe(false);
  });

  it('rejects https where the dev server is http', () => {
    expect(isInternalUrl('https://localhost:5273/', DEV)).toBe(false);
  });

  it('rejects external sites', () => {
    expect(isInternalUrl('https://example.com', DEV)).toBe(false);
    expect(isInternalUrl('garbage', DEV)).toBe(false);
  });
});

describe('schemeOf', () => {
  it('names the scheme for the security log', () => {
    expect(schemeOf('https://example.com')).toBe('https:');
    expect(schemeOf('file:///x')).toBe('file:');
  });

  it('does not throw on junk', () => {
    expect(schemeOf('nonsense')).toBe('<unparseable>');
  });
});
