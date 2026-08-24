/** Lista bibliotek zewnętrznych i ich licencji - pokazywana na ekranie "O programie". */

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string;
}

export const THIRD_PARTY_LICENSES: LicenseEntry[] = [
  { name: 'Electron', version: '38.x', license: 'MIT', url: 'https://github.com/electron/electron' },
  { name: 'React', version: '18.x', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'React DOM', version: '18.x', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'Zustand', version: '5.x', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Vite', version: '6.x', license: 'MIT', url: 'https://github.com/vitejs/vite' },
  { name: 'Vitest', version: '3.x', license: 'MIT', url: 'https://github.com/vitest-dev/vitest' },
  { name: 'TypeScript', version: '5.x', license: 'Apache-2.0', url: 'https://github.com/microsoft/TypeScript' },
  { name: 'esbuild', version: '0.25.x', license: 'MIT', url: 'https://github.com/evanw/esbuild' },
  { name: 'electron-builder', version: '26.x', license: 'MIT', url: 'https://github.com/electron-userland/electron-builder' },
  { name: 'adm-zip', version: '0.5.x', license: 'MIT', url: 'https://github.com/cthackers/adm-zip' },
  { name: 'fast-xml-parser', version: '4.x', license: 'MIT', url: 'https://github.com/NaturalIntelligence/fast-xml-parser' },
  { name: 'better-sqlite3 (opcjonalny)', version: '11.x', license: 'MIT', url: 'https://github.com/WiseLibs/better-sqlite3' },
  { name: 'keytar (opcjonalny)', version: '7.x', license: 'MIT', url: 'https://github.com/atom/node-keytar' },
  { name: 'ESLint', version: '9.x', license: 'MIT', url: 'https://github.com/eslint/eslint' },
  { name: 'sharp (tylko build ikony)', version: '0.34.x', license: 'Apache-2.0', url: 'https://github.com/lovell/sharp' },
];

/** Usługi i dane zewnętrzne, z których NightMC korzysta. */
export const DATA_SOURCES: LicenseEntry[] = [
  { name: 'Mojang / Minecraft (manifest, biblioteki, assety)', version: '-', license: 'Minecraft EULA', url: 'https://www.minecraft.net/eula' },
  { name: 'Minecraft Usage Guidelines', version: '-', license: 'Warunki Mojang', url: 'https://www.minecraft.net/usage-guidelines' },
  { name: 'Modrinth API', version: 'v2', license: 'Warunki Modrinth', url: 'https://docs.modrinth.com/api/' },
  { name: 'FabricMC Meta', version: 'v2', license: 'Apache-2.0', url: 'https://meta.fabricmc.net/' },
  { name: 'MinecraftForge Maven', version: '-', license: 'LGPL-2.1', url: 'https://maven.minecraftforge.net/' },
  { name: 'NeoForged Maven', version: '-', license: 'LGPL-2.1', url: 'https://maven.neoforged.net/' },
  { name: 'Eclipse Temurin (Adoptium)', version: '-', license: 'GPL-2.0 with Classpath Exception', url: 'https://adoptium.net/' },
  { name: 'CurseForge API (tylko z własnym kluczem)', version: 'v1', license: 'Warunki CurseForge', url: 'https://docs.curseforge.com/' },
];
