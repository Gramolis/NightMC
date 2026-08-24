import { describe, expect, it } from 'vitest';
import { sanitizeChangelog } from '../src/main/changelog.js';

describe('changelog GitHub', () => {
  it('zachowuje bezpieczny Markdown i usuwa HTML wykonywalny', () => {
    const result = sanitizeChangelog('# NightMC\r\n<script>alert(1)</script>\r\n## 1.0.1\r\n- Zmiana');
    expect(result).toContain('# NightMC\n\n## 1.0.1\n- Zmiana');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('ogranicza rozmiar pobranej treści', () => {
    const result = sanitizeChangelog(`# NightMC\n${'x'.repeat(300_000)}`);
    expect(result.length).toBeLessThanOrEqual(256 * 1024);
  });
});
