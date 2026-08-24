import { describe, it, expect } from 'vitest';
import {
  EVENT_CHANNELS,
  FILENAME_PATTERN,
  ID_PATTERN,
  INVOKE_SCHEMAS,
  isEventChannel,
  isInvokeChannel,
  USERNAME_PATTERN,
  ValidationError,
  v,
  VERSION_PATTERN,
} from '../src/shared/ipc.js';

describe('walidator IPC', () => {
  it('sprawdza typy podstawowe', () => {
    expect(v.string()('abc')).toBe('abc');
    expect(() => v.string()(5)).toThrow(ValidationError);
    expect(() => v.string({ max: 2 })('abcd')).toThrow(ValidationError);
    expect(v.number({ int: true, min: 1 })(3)).toBe(3);
    expect(() => v.number({ int: true })(1.5)).toThrow(ValidationError);
    expect(() => v.number({ max: 10 })(11)).toThrow(ValidationError);
    expect(() => v.number()(Number.NaN)).toThrow(ValidationError);
    expect(v.boolean()(true)).toBe(true);
    expect(() => v.boolean()('true')).toThrow(ValidationError);
  });

  it('sprawdza wartości dopuszczalne', () => {
    const lit = v.literal('a', 'b');
    expect(lit('a')).toBe('a');
    expect(() => lit('c')).toThrow(ValidationError);
  });

  it('sprawdza tablice i ich limity', () => {
    expect(v.array(v.string())(['a', 'b'])).toEqual(['a', 'b']);
    expect(() => v.array(v.string())('nie tablica')).toThrow(ValidationError);
    expect(() => v.array(v.string(), { max: 1 })(['a', 'b'])).toThrow(ValidationError);
  });

  it('odrzuca obiekty o złej strukturze i wskazuje pole', () => {
    const schema = v.object({ id: v.string(), count: v.number() });
    expect(schema({ id: 'x', count: 1 })).toEqual({ id: 'x', count: 1 });
    expect(() => schema({ id: 'x' })).toThrow(/count/);
    expect(() => schema(null)).toThrow(ValidationError);
    expect(() => schema([1, 2])).toThrow(ValidationError);
  });

  it('odcina pola spoza schematu (brak prototype pollution)', () => {
    const schema = v.object({ id: v.string() });
    const out = schema({ id: 'x', __proto__: { evil: true }, extra: 'nadmiar' }) as any;
    expect(out.extra).toBeUndefined();
    expect(Object.keys(out)).toEqual(['id']);
  });

  it('obsługuje pola opcjonalne', () => {
    const schema = v.object({ a: v.optional(v.string()) });
    expect(schema({}).a).toBeUndefined();
    expect(schema({ a: null }).a).toBeUndefined();
    expect(schema({ a: 'x' }).a).toBe('x');
  });
});

describe('wzorce identyfikatorów', () => {
  it('ID nie może zawierać separatorów ścieżki', () => {
    expect(ID_PATTERN.test('inst-abc123')).toBe(true);
    expect(ID_PATTERN.test('../etc')).toBe(false);
    expect(ID_PATTERN.test('a/b')).toBe(false);
    expect(ID_PATTERN.test('a.b')).toBe(false);
    expect(ID_PATTERN.test('')).toBe(false);
  });

  it('wersja dopuszcza kropki, ale nie ucieczki ze ścieżki', () => {
    expect(VERSION_PATTERN.test('1.21.4')).toBe(true);
    expect(VERSION_PATTERN.test('fabric-loader-0.16.9-1.21.4')).toBe(true);
    expect(VERSION_PATTERN.test('1.20.1-47.2.20')).toBe(true);
    expect(VERSION_PATTERN.test('../../evil')).toBe(false);
    expect(VERSION_PATTERN.test('a/b')).toBe(false);
    expect(VERSION_PATTERN.test('..')).toBe(false);
  });

  it('nazwa pliku moda dopuszcza myślniki i kropki, ale nie ścieżki', () => {
    expect(FILENAME_PATTERN.test('fabric-api-0.100.1+1.21.jar')).toBe(true);
    expect(FILENAME_PATTERN.test('Sodium Extra.jar.disabled')).toBe(true);
    expect(FILENAME_PATTERN.test('../evil.jar')).toBe(false);
    expect(FILENAME_PATTERN.test('mods/evil.jar')).toBe(false);
    expect(FILENAME_PATTERN.test('C:\\evil.jar')).toBe(false);
    expect(FILENAME_PATTERN.test('..')).toBe(false);
  });

  it('nazwa gracza offline zgodna z regułami Minecrafta', () => {
    expect(USERNAME_PATTERN.test('Nocny_Gracz')).toBe(true);
    expect(USERNAME_PATTERN.test('ab')).toBe(false);
    expect(USERNAME_PATTERN.test('a'.repeat(17))).toBe(false);
    expect(USERNAME_PATTERN.test('zły;nick')).toBe(false);
  });
});

describe('kontrakt kanałów', () => {
  it('rozpoznaje tylko zadeklarowane kanały', () => {
    expect(isInvokeChannel('game:launch')).toBe(true);
    expect(isInvokeChannel('cokolwiek:hack')).toBe(false);
    expect(isInvokeChannel('__proto__')).toBe(false);
    expect(isEventChannel('event:log-line')).toBe(true);
    expect(isEventChannel('event:cokolwiek')).toBe(false);
  });

  it('każdy kanał ma walidator', () => {
    for (const [name, schema] of Object.entries(INVOKE_SCHEMAS)) {
      expect(typeof schema, `kanał ${name}`).toBe('function');
    }
    expect(Object.keys(INVOKE_SCHEMAS).length).toBeGreaterThan(40);
    expect(EVENT_CHANNELS.length).toBeGreaterThan(0);
  });

  it('odrzuca ładunki, które próbują wyjść ze ścieżki', () => {
    const schema = INVOKE_SCHEMAS['instances:delete'];
    expect(() => schema({ id: '../../../Windows' })).toThrow(ValidationError);
    expect(schema({ id: 'inst-abc' })).toEqual({ id: 'inst-abc' });
  });

  it('odrzuca próbę wstrzyknięcia ścieżki w nazwę pliku moda', () => {
    const schema = INVOKE_SCHEMAS['mods:delete'];
    expect(() => schema({ instanceId: 'inst-a', fileName: '../../../evil.jar' })).toThrow(ValidationError);
    expect(() => schema({ instanceId: 'inst-a', fileName: 'C:\\Windows\\evil.dll' })).toThrow(ValidationError);
    expect(schema({ instanceId: 'inst-a', fileName: 'sodium.jar' }).fileName).toBe('sodium.jar');
  });

  it('ogranicza zakres pamięci przekazywanej z interfejsu', () => {
    const schema = INVOKE_SCHEMAS['instances:update'];
    expect(() => schema({ id: 'inst-a', patch: { memoryMax: -1 } })).toThrow(ValidationError);
    expect(() => schema({ id: 'inst-a', patch: { memoryMax: 99_999_999 } })).toThrow(ValidationError);
  });

  it('wymusza dozwolone wartości katalogu do otwarcia', () => {
    const schema = INVOKE_SCHEMAS['app:openPath'];
    expect(() => schema({ target: 'C:\\Windows' })).toThrow(ValidationError);
    expect(schema({ target: 'logs' }).target).toBe('logs');
  });
});
