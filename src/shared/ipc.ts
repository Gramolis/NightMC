/**
 * Kontrakt IPC.
 *
 * Renderer NIGDY nie dostaje dostępu do `ipcRenderer` ani do modułów Node.
 * Preload eksponuje wyłącznie kanały z tej listy, a proces główny waliduje
 * każdy ładunek zanim cokolwiek zrobi. To jest jedyna powierzchnia ataku
 * między niezaufanym rendererem a systemem plików / procesami.
 */

/* ------------------------------------------------------------------ */
/* Miniaturowy walidator (bez zależności zewnętrznych)                 */
/* ------------------------------------------------------------------ */

export type Validator<T> = (v: unknown) => T;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const fail = (path: string, expected: string): never => {
  throw new ValidationError(`Nieprawidłowy ładunek IPC: "${path}" powinno być ${expected}`);
};

export const v = {
  any(): Validator<unknown> {
    return (x) => x;
  },
  void(): Validator<void> {
    return (x) => {
      if (x !== undefined && x !== null) fail('argument', 'pominięty');
      return undefined as void;
    };
  },
  string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Validator<string> {
    return (x) => {
      if (typeof x !== 'string') return fail('value', 'tekstem');
      if (opts.min !== undefined && x.length < opts.min) fail('value', `tekstem o długości >= ${opts.min}`);
      if (opts.max !== undefined && x.length > opts.max) fail('value', `tekstem o długości <= ${opts.max}`);
      if (opts.pattern && !opts.pattern.test(x)) fail('value', `tekstem pasującym do ${opts.pattern}`);
      return x;
    };
  },
  number(opts: { min?: number; max?: number; int?: boolean } = {}): Validator<number> {
    return (x) => {
      if (typeof x !== 'number' || !Number.isFinite(x)) return fail('value', 'liczbą');
      if (opts.int && !Number.isInteger(x)) fail('value', 'liczbą całkowitą');
      if (opts.min !== undefined && x < opts.min) fail('value', `liczbą >= ${opts.min}`);
      if (opts.max !== undefined && x > opts.max) fail('value', `liczbą <= ${opts.max}`);
      return x;
    };
  },
  boolean(): Validator<boolean> {
    return (x) => (typeof x === 'boolean' ? x : fail('value', 'wartością logiczną'));
  },
  literal<const L extends readonly string[]>(...values: L): Validator<L[number]> {
    return (x) =>
      typeof x === 'string' && (values as readonly string[]).includes(x)
        ? (x as L[number])
        : fail('value', `jedną z: ${values.join(', ')}`);
  },
  array<T>(item: Validator<T>, opts: { max?: number } = {}): Validator<T[]> {
    return (x) => {
      if (!Array.isArray(x)) return fail('value', 'tablicą');
      if (opts.max !== undefined && x.length > opts.max) fail('value', `tablicą <= ${opts.max} elementów`);
      return x.map(item);
    };
  },
  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return (x) => (x === undefined || x === null ? undefined : inner(x));
  },
  object<S extends Record<string, Validator<any>>>(
    shape: S,
  ): Validator<{ [K in keyof S]: S[K] extends Validator<infer R> ? R : never }> {
    return (x) => {
      if (typeof x !== 'object' || x === null || Array.isArray(x)) return fail('value', 'obiektem');
      const src = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        try {
          out[key] = shape[key]!(src[key]);
        } catch (e) {
          throw new ValidationError(
            `Nieprawidłowy ładunek IPC w polu "${key}": ${(e as Error).message}`,
          );
        }
      }
      return out as any;
    };
  },
  record<T>(value: Validator<T>, opts: { maxKeys?: number } = {}): Validator<Record<string, T>> {
    return (x) => {
      if (typeof x !== 'object' || x === null || Array.isArray(x)) return fail('value', 'obiektem');
      const src = x as Record<string, unknown>;
      const keys = Object.keys(src);
      if (opts.maxKeys !== undefined && keys.length > opts.maxKeys) fail('value', `obiektem <= ${opts.maxKeys} kluczy`);
      const out: Record<string, T> = {};
      for (const k of keys) out[k] = value(src[k]);
      return out;
    };
  },
};

/* ------------------------------------------------------------------ */
/* Wzorce identyfikatorów                                              */
/* ------------------------------------------------------------------ */

/** Identyfikatory wewnętrzne: tylko [a-z0-9-_], bez kropek i separatorów ścieżki. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Identyfikatory wersji Minecraft/loadera: dopuszczamy kropki, ale nie ".." ani slashy. */
export const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
/** Nazwa gracza offline zgodna z regułami Minecrafta. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
/**
 * Nazwa pliku bez separatorow sciezki, bez znakow sterujacych i bez "..".
 * Myslniki, kropki i spacje sa dozwolone - typowe nazwy modow ich uzywaja.
 */
// eslint-disable-next-line no-control-regex
export const FILENAME_PATTERN = /^(?!\.{1,2}$)(?!.*\.\.)[^/\\:*?"<>|\x00-\x1f]{1,200}$/;

const id = () => v.string({ pattern: ID_PATTERN });
const version = () => v.string({ pattern: VERSION_PATTERN });

/* ------------------------------------------------------------------ */
/* Kanały wywoływane (invoke)                                          */
/* ------------------------------------------------------------------ */

export const INVOKE_SCHEMAS = {
  /* --- system / ustawienia --- */
  'app:systemInfo': v.void(),
  'app:openExternal': v.object({ url: v.string({ max: 2048 }) }),
  'app:openPath': v.object({ target: v.literal('data', 'instances', 'runtimes', 'cache', 'logs'), instanceId: v.optional(id()) }),
  'app:licenses': v.void(),
  'settings:get': v.void(),
  'settings:set': v.object({
    patch: v.object({
      instancesDir: v.optional(v.string({ max: 512 })),
      concurrency: v.optional(v.number({ int: true, min: 1, max: 24 })),
      closeOnLaunch: v.optional(v.literal('minimize', 'tray', 'nothing', 'close')),
      showSnapshots: v.optional(v.boolean()),
      showOldVersions: v.optional(v.boolean()),
      defaultMemoryMin: v.optional(v.number({ int: true, min: 256, max: 65536 })),
      defaultMemoryMax: v.optional(v.number({ int: true, min: 512, max: 262144 })),
      defaultJvmArgs: v.optional(v.string({ max: 2048 })),
      checkUpdates: v.optional(v.boolean()),
      acceptedOfflineWarning: v.optional(v.boolean()),
      curseforgeKeySet: v.optional(v.boolean()),
    }),
  }),
  'settings:pickInstancesDir': v.void(),

  /* --- wersje Minecrafta --- */
  'mc:versions': v.object({ refresh: v.optional(v.boolean()) }),
  'mc:versionDetail': v.object({ versionId: version() }),

  /* --- modloadery --- */
  'loader:versions': v.object({ loader: v.literal('fabric', 'forge', 'neoforge'), mcVersion: version() }),

  /* --- instancje --- */
  'instances:list': v.void(),
  'instances:create': v.object({
    name: v.string({ min: 1, max: 64 }),
    mcVersion: version(),
    loader: v.literal('vanilla', 'fabric', 'forge', 'neoforge'),
    loaderVersion: v.optional(version()),
    icon: v.optional(v.string({ max: 128 })),
    memoryMin: v.optional(v.number({ int: true, min: 256, max: 65536 })),
    memoryMax: v.optional(v.number({ int: true, min: 512, max: 262144 })),
  }),
  'instances:update': v.object({
    id: id(),
    patch: v.object({
      name: v.optional(v.string({ min: 1, max: 64 })),
      icon: v.optional(v.string({ max: 128 })),
      javaPath: v.optional(v.string({ max: 512 })),
      memoryMin: v.optional(v.number({ int: true, min: 256, max: 65536 })),
      memoryMax: v.optional(v.number({ int: true, min: 512, max: 262144 })),
      jvmArgs: v.optional(v.string({ max: 2048 })),
      width: v.optional(v.number({ int: true, min: 320, max: 7680 })),
      height: v.optional(v.number({ int: true, min: 240, max: 4320 })),
      fullscreen: v.optional(v.boolean()),
      notes: v.optional(v.string({ max: 2000 })),
    }),
  }),
  'instances:delete': v.object({ id: id() }),
  'instances:duplicate': v.object({ id: id(), name: v.string({ min: 1, max: 64 }) }),
  'instances:install': v.object({ id: id() }),
  'instances:repair': v.object({ id: id() }),
  'instances:export': v.object({ id: id() }),
  'instances:import': v.void(),
  'instances:backup': v.object({ id: id() }),
  'instances:shortcut': v.object({ id: id() }),

  /* --- mody --- */
  'mods:list': v.object({ instanceId: id() }),
  'mods:toggle': v.object({ instanceId: id(), fileName: v.string({ pattern: FILENAME_PATTERN }) }),
  'mods:delete': v.object({ instanceId: id(), fileName: v.string({ pattern: FILENAME_PATTERN }) }),
  'mods:search': v.object({
    query: v.string({ max: 200 }),
    mcVersion: v.optional(version()),
    loader: v.optional(v.literal('fabric', 'forge', 'neoforge', 'quilt')),
    categories: v.optional(v.array(v.string({ max: 64 }), { max: 20 })),
    offset: v.optional(v.number({ int: true, min: 0, max: 5000 })),
    limit: v.optional(v.number({ int: true, min: 1, max: 100 })),
  }),
  'mods:versions': v.object({
    projectId: v.string({ max: 64, pattern: /^[A-Za-z0-9]{1,64}$/ }),
    mcVersion: v.optional(version()),
    loader: v.optional(v.literal('fabric', 'forge', 'neoforge', 'quilt')),
  }),
  'mods:install': v.object({ instanceId: id(), versionId: v.string({ max: 64, pattern: /^[A-Za-z0-9]{1,64}$/ }), withDependencies: v.optional(v.boolean()) }),
  'mods:checkUpdates': v.object({ instanceId: id() }),
  /** Analiza lokalnych plików w minecraft/mods wybranej instancji (tylko odczyt). */
  'mods:analyze': v.object({ instanceId: id() }),
  'mods:update': v.object({
    instanceId: id(),
    fileName: v.string({ pattern: FILENAME_PATTERN }),
    source: v.literal('modrinth', 'curseforge'),
    projectId: v.optional(v.string({ max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ })),
    newVersionId: v.string({ max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ }),
  }),

  /* --- paczki --- */
  'packs:pickAndPreview': v.void(),
  'packs:import': v.object({ previewToken: id(), instanceName: v.string({ min: 1, max: 64 }) }),
  'packs:exportMrpack': v.object({ instanceId: id() }),
  'packs:pickManualFile': v.object({ previewToken: id(), fileName: v.string({ max: 200 }) }),
  'packBuilder:search': v.object({
    query: v.string({ max: 200 }),
    mcVersion: version(),
    loader: v.literal('fabric', 'forge', 'neoforge'),
    sources: v.array(v.literal('modrinth', 'curseforge'), { max: 2 }),
  }),
  'packBuilder:versions': v.object({
    source: v.literal('modrinth', 'curseforge'),
    projectId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
    mcVersion: version(),
    loader: v.literal('fabric', 'forge', 'neoforge'),
  }),
  'packBuilder:install': v.object({
    instanceId: id(),
    items: v.array(v.object({
      source: v.literal('modrinth', 'curseforge'),
      projectId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
      versionId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
      title: v.string({ min: 1, max: 200 }),
      versionNumber: v.string({ min: 1, max: 128 }),
    }), { max: 200 }),
  }),
  'packBuilder:searchPacks': v.object({
    query: v.string({ max: 200 }),
    sources: v.array(v.literal('modrinth', 'curseforge'), { max: 2 }),
  }),
  'packBuilder:packVersions': v.object({
    source: v.literal('modrinth', 'curseforge'),
    projectId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
  }),
  'packBuilder:installPack': v.object({
    source: v.literal('modrinth', 'curseforge'),
    projectId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
    versionId: v.string({ min: 1, max: 64, pattern: /^[A-Za-z0-9_-]+$/ }),
    instanceName: v.string({ min: 1, max: 64 }),
  }),

  /* --- Java --- */
  'java:detect': v.void(),
  'java:download': v.object({ major: v.number({ int: true, min: 8, max: 25 }) }),
  'java:pick': v.void(),
  'java:remove': v.object({ path: v.string({ max: 512 }) }),
  'java:test': v.object({ path: v.string({ max: 512 }) }),

  /* --- konta --- */
  'accounts:list': v.void(),
  'accounts:loginMicrosoft': v.void(),
  'accounts:addOffline': v.object({
    username: v.string({ pattern: USERNAME_PATTERN }),
    skinPath: v.optional(v.string({ max: 512 })),
    avatar: v.optional(v.string({ max: 512 })),
  }),
  'accounts:updateOffline': v.object({
    id: id(),
    username: v.string({ pattern: USERNAME_PATTERN }),
    skinPath: v.optional(v.string({ max: 512 })),
    skinData: v.optional(v.string({ max: 3_000_000 })),
    removeSkin: v.boolean(),
  }),
  'accounts:remove': v.object({ id: id() }),
  'accounts:setActive': v.object({ id: id() }),
  'accounts:refresh': v.object({ id: id() }),
  'accounts:pickSkin': v.void(),

  /* --- serwery --- */
  'servers:list': v.void(),
  'servers:add': v.object({
    name: v.string({ min: 1, max: 64 }),
    address: v.string({ min: 1, max: 253 }),
    port: v.number({ int: true, min: 1, max: 65535 }),
    description: v.optional(v.string({ max: 500 })),
    mcVersion: v.optional(version()),
    instanceId: v.optional(id()),
    userMarkedOffline: v.boolean(),
  }),
  'servers:remove': v.object({ id: id() }),
  'servers:update': v.object({
    id: id(),
    patch: v.object({
      name: v.optional(v.string({ min: 1, max: 64 })),
      address: v.optional(v.string({ min: 1, max: 253 })),
      port: v.optional(v.number({ int: true, min: 1, max: 65535 })),
      description: v.optional(v.string({ max: 500 })),
      instanceId: v.optional(id()),
      userMarkedOffline: v.optional(v.boolean()),
    }),
  }),
  'servers:ping': v.object({ address: v.string({ max: 253 }), port: v.number({ int: true, min: 1, max: 65535 }) }),

  /* --- gra --- */
  'game:launch': v.object({ instanceId: id(), serverId: v.optional(id()) }),
  'game:stop': v.object({ instanceId: id() }),
  'game:state': v.void(),
  'game:cancelDownload': v.void(),

  /* --- logi --- */
  'logs:get': v.object({ instanceId: v.optional(id()), limit: v.optional(v.number({ int: true, min: 1, max: 5000 })) }),
  'logs:clear': v.object({ instanceId: v.optional(id()) }),
  'logs:copy': v.object({ instanceId: v.optional(id()) }),
  'logs:saveToFile': v.object({ instanceId: v.optional(id()) }),

  /* --- aktualizacje i aktualności --- */
  'updates:check': v.void(),
  'updates:download': v.void(),
  'news:get': v.void(),
  'changelog:get': v.object({ refresh: v.optional(v.boolean()) }),

  /* --- CurseForge --- */
  'curseforge:setKey': v.object({ key: v.string({ max: 256 }) }),
  'curseforge:clearKey': v.void(),
} as const;

export type InvokeChannel = keyof typeof INVOKE_SCHEMAS;

/** Ładunek danego kanału po walidacji. */
export type InvokePayload<C extends InvokeChannel> =
  (typeof INVOKE_SCHEMAS)[C] extends Validator<infer R> ? R : never;

/* ------------------------------------------------------------------ */
/* Kanały zdarzeń (main -> renderer)                                   */
/* ------------------------------------------------------------------ */

export const EVENT_CHANNELS = [
  'event:download-progress',
  'event:download-finished',
  'event:game-state',
  'event:log-line',
  'event:instances-changed',
  'event:accounts-changed',
  'event:update-available',
  'event:toast',
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isEventChannel(x: unknown): x is EventChannel {
  return typeof x === 'string' && (EVENT_CHANNELS as readonly string[]).includes(x);
}

export function isInvokeChannel(x: unknown): x is InvokeChannel {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(INVOKE_SCHEMAS, x);
}
