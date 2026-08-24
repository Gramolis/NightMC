/** Stałe współdzielone przez proces główny, preload i renderer. */

export const APP_NAME = 'NightMC';
export const APP_ID = 'pl.nightmc.launcher';

/** Zdanie wymagane przez Minecraft Usage Guidelines. */
export const LEGAL_DISCLAIMER =
  'NightMC nie jest oficjalnym produktem Mojang Studios ani Microsoft i nie jest przez nie zatwierdzony.';

export const OFFLINE_MULTIPLAYER_WARNING =
  'Serwery online-mode=false nie weryfikują tożsamości graczy przez Microsoft. ' +
  'Inna osoba może próbować użyć dowolnej nazwy gracza. ' +
  'Korzystaj wyłącznie z zaufanych serwerów posiadających własne zabezpieczenia.';

export const OFFLINE_PROFILE_NOTE =
  'Ten profil może dołączać wyłącznie do serwerów działających z online-mode=false.';

/* ------------------------------------------------------------------ */
/* Adresy usług sieciowych - jedyne hosty, z którymi NightMC się łączy */
/* ------------------------------------------------------------------ */

export const ENDPOINTS = {
  mojangVersionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  mojangResources: 'https://resources.download.minecraft.net',
  fabricMeta: 'https://meta.fabricmc.net/v2/versions',
  forgeMaven: 'https://maven.minecraftforge.net',
  forgeMetadata:
    'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
  neoforgeMaven: 'https://maven.neoforged.net/releases',
  neoforgeMetadata:
    'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
  modrinthApi: 'https://api.modrinth.com/v2',
  adoptiumApi: 'https://api.adoptium.net/v3',
  msAuthorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  msToken: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xboxAuth: 'https://user.auth.xboxlive.com/user/authenticate',
  xstsAuth: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLogin: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcEntitlements: 'https://api.minecraftservices.com/entitlements/mcstore',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
  githubApi: 'https://api.github.com',
  curseforgeApi: 'https://api.curseforge.com/v1',
  eula: 'https://www.minecraft.net/eula',
  usageGuidelines: 'https://www.minecraft.net/usage-guidelines',
} as const;

/**
 * Lista hostów dopuszczonych do połączeń wychodzących.
 * Wszystko poza tą listą jest odrzucane w `net.ts` - to twarda blokada
 * przed przypadkowym wyciekiem danych i przed SSRF z danych zdalnych.
 */
export const ALLOWED_HOSTS: readonly string[] = [
  // Mojang / Minecraft
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'launcher.mojang.com',
  'libraries.minecraft.net',
  'resources.download.minecraft.net',
  'assets.minecraft.net',
  'api.minecraftservices.com',
  'sessionserver.mojang.com',
  'api.mojang.com',
  'textures.minecraft.net',
  // Microsoft / Xbox
  'login.microsoftonline.com',
  'login.live.com',
  'user.auth.xboxlive.com',
  'xsts.auth.xboxlive.com',
  // Modloadery
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'maven.minecraftforge.net',
  'files.minecraftforge.net',
  'maven.neoforged.net',
  // Mody
  'api.modrinth.com',
  'cdn.modrinth.com',
  'cdn-raw.modrinth.com',
  // Java
  'api.adoptium.net',
  'github.com',
  'objects.githubusercontent.com',
  // Pliki binarne GitHub Releases (m.in. przekierowanie JRE z Adoptium).
  'release-assets.githubusercontent.com',
  'api.github.com',
  'raw.githubusercontent.com',
  // CurseForge (tylko z własnym kluczem użytkownika)
  'api.curseforge.com',
  'edge.forgecdn.net',
  'mediafilez.forgecdn.net',
];

/** Opis usług pokazywany na ekranie "Prywatność / Usługi sieciowe". */
export const NETWORK_SERVICES = [
  {
    name: 'Mojang / Minecraft',
    hosts: ['piston-meta.mojang.com', 'libraries.minecraft.net', 'resources.download.minecraft.net'],
    purpose: 'Manifest wersji, biblioteki, assety i pliki klienta gry.',
    optional: false,
  },
  {
    name: 'Microsoft / Xbox Live',
    hosts: ['login.microsoftonline.com', 'user.auth.xboxlive.com', 'xsts.auth.xboxlive.com'],
    purpose: 'Logowanie do konta Microsoft Premium. Wyłącznie przy logowaniu.',
    optional: true,
  },
  {
    name: 'Minecraft Services',
    hosts: ['api.minecraftservices.com'],
    purpose: 'Weryfikacja posiadania gry, profil i skórka konta Premium.',
    optional: true,
  },
  {
    name: 'Modrinth',
    hosts: ['api.modrinth.com', 'cdn.modrinth.com'],
    purpose: 'Wyszukiwanie i pobieranie modów oraz paczek .mrpack.',
    optional: true,
  },
  {
    name: 'FabricMC',
    hosts: ['meta.fabricmc.net', 'maven.fabricmc.net'],
    purpose: 'Metadane i biblioteki loadera Fabric.',
    optional: true,
  },
  {
    name: 'MinecraftForge',
    hosts: ['maven.minecraftforge.net'],
    purpose: 'Metadane, instalatory i biblioteki Forge.',
    optional: true,
  },
  {
    name: 'NeoForged',
    hosts: ['maven.neoforged.net'],
    purpose: 'Metadane, instalatory i biblioteki NeoForge.',
    optional: true,
  },
  {
    name: 'Eclipse Adoptium',
    hosts: ['api.adoptium.net', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
    purpose: 'Pobieranie środowiska Java (Temurin).',
    optional: true,
  },
  {
    name: 'GitHub NightMC',
    hosts: ['api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
    purpose: 'Sprawdzanie i pobieranie aktualizacji oraz synchronizacja changeloga NightMC.',
    optional: true,
  },
  {
    name: 'CurseForge',
    hosts: ['api.curseforge.com', 'edge.forgecdn.net'],
    purpose: 'Tylko jeśli sam wpiszesz własny klucz API. Domyślnie wyłączone.',
    optional: true,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Limity i domyślne wartości                                          */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  /** Maksymalny rozmiar odpowiedzi JSON z API (16 MiB). */
  maxJsonBytes: 16 * 1024 * 1024,
  /** Maksymalny rozmiar pliku news.json (512 KiB). */
  maxNewsBytes: 512 * 1024,
  /** Timeout pojedynczego żądania metadanych. */
  metaTimeoutMs: 20_000,
  /** Timeout pojedynczego pobrania pliku. */
  downloadTimeoutMs: 120_000,
  /** Domyślna liczba równoległych pobrań. */
  defaultConcurrency: 8,
  maxConcurrency: 24,
  /** Liczba prób ponowienia pobrania. */
  retries: 4,
  /** Maksymalny rozmiar rozpakowanego archiwum (8 GiB) - ochrona przed ZIP bomb. */
  maxExtractBytes: 8 * 1024 * 1024 * 1024,
  /** Maksymalny współczynnik kompresji dla pojedynczego wpisu. */
  maxCompressionRatio: 200,
  /** Maksymalna liczba wpisów w archiwum. */
  maxZipEntries: 200_000,
  /** Maksymalna liczba linii logu trzymana w pamięci. */
  maxLogLines: 5000,
} as const;

/** Domyślne argumenty JVM - stabilny zestaw G1GC używany przez większość launcherów. */
export const DEFAULT_JVM_ARGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
].join(' ');

export const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge'] as const;

/** Wersje Javy, które NightMC potrafi wykryć i pobrać. */
export const SUPPORTED_JAVA_MAJORS = [8, 11, 16, 17, 21] as const;
