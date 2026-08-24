<div align="center">

# NightMC

**Launcher Minecraft Java Edition — Premium (Microsoft) oraz Offline / Non-Premium**

Vanilla · Fabric · Forge · NeoForge · Modrinth · `.mrpack` · CurseForge ZIP · automatyczna Java

</div>

> **NightMC nie jest oficjalnym produktem Mojang Studios ani Microsoft i nie jest przez nie zatwierdzony.**

---

## Spis treści

1. [Czym jest NightMC](#czym-jest-nightmc)
2. [Wymagania programistyczne](#wymagania-programistyczne)
3. [Szybki start](#szybki-start)
4. [Budowanie NightMC.exe](#budowanie-nightmcexe)
5. [Konfiguracja: Microsoft Entra Client ID](#konfiguracja-microsoft-entra-client-id)
6. [Konfiguracja: GitHub Releases](#konfiguracja-github-releases)
7. [Konfiguracja: aktualności](#konfiguracja-aktualności)
8. [Podpisywanie kodu Windows i SmartScreen](#podpisywanie-kodu-windows-i-smartscreen)
9. [Gdzie NightMC trzyma dane](#gdzie-nightmc-trzyma-dane)
10. [Profile Offline / Non-Premium](#profile-offline--non-premium)
11. [Import paczek](#import-paczek)
12. [Usuwanie tokenów](#usuwanie-tokenów)
13. [Zasady bezpieczeństwa](#zasady-bezpieczeństwa)
14. [Struktura projektu](#struktura-projektu)
15. [Znane ograniczenia](#znane-ograniczenia)
16. [Publikowanie wersji](#publikowanie-wersji)
17. [Zgodność prawna i licencje](#zgodność-prawna-i-licencje)

---

## Czym jest NightMC

NightMC to launcher desktopowy (Electron + React + TypeScript) dystrybuowany jako **jeden przenośny plik `NightMC.exe`**. Nie ma backendu, panelu administratora ani telemetrii.

Obsługuje:

- oficjalne konta **Microsoft Premium** posiadające Minecraft Java Edition,
- **profile Offline / Non-Premium** ze stabilnym UUID,
- Vanilla, **Fabric**, **Forge**, **NeoForge**,
- osobne instancje gry z własnymi modami, configami, światami i logami,
- mody z **Modrinth**, import `.mrpack`, import lokalnych paczek **CurseForge**,
- automatyczne wykrywanie i pobieranie **Javy** (Eclipse Temurin),
- ustawienia RAM, logi na żywo, raportowanie i diagnostykę crashy,
- aktualizacje przez **GitHub Releases** i aktualności ze statycznego JSON-a.

Czego **nie** robi i robić nie będzie: nie omija logowania Microsoft, nie tworzy fałszywych kont ani sesji premium, nie pozwala profilowi offline wejść na serwer z `online-mode=true`, nie przechowuje haseł Microsoft, nie zawiera plików gry ani cudzych kluczy API.

---

## Wymagania programistyczne

| Element | Wersja |
|---|---|
| Node.js | **20.19+** (zalecane 22 LTS) |
| npm | 10+ |
| System do zbudowania EXE | **Windows 10/11 x64** |
| Visual Studio Build Tools | tylko jeśli chcesz zbudować `better-sqlite3`/`keytar` ze źródeł |

> Moduły natywne (`better-sqlite3`, `keytar`) są **opcjonalne**. Jeśli się nie zainstalują, NightMC automatycznie użyje wbudowanego `node:sqlite` oraz `safeStorage` (DPAPI) — build i aplikacja działają tak czy tak.

Do zbudowania `NightMC.exe` potrzebny jest Windows. `electron-builder` z targetem `portable` korzysta z narzędzi Windows; na Linuksie/macOS wymagałby Wine i nie jest w tym projekcie wspierany.

---

## Szybki start

```bash
git clone <adres-twojego-repo> nightmc
cd nightmc

npm install          # instalacja zależności
copy .env.example .env   # (Windows) uzupełnij wartości — patrz sekcje niżej

npm run icon         # wygeneruje build/icon.ico z oryginalnego logo
npm run dev          # tryb deweloperski (Vite + Electron z hot reload)
```

Pozostałe komendy:

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest (testy jednostkowe + end-to-end)
npm run build        # kompilacja main + preload + renderer do out/
npm run build:exe    # pełny build + dist/NightMC.exe
npm run build:nsis   # dodatkowo instalator dist/NightMC-Setup.exe
```

---

## Budowanie NightMC.exe

```bash
npm install
npm run icon
npm run build:exe
```

Gotowy plik znajdziesz dokładnie tutaj:

```text
dist\NightMC.exe
```

Właściwości gotowego pliku:

- działa na czystym **Windows 10 i 11 x64** bez instalowania Node.js, npm ani żadnych bibliotek,
- **nie wymaga uprawnień administratora** (`requestedExecutionLevel: asInvoker`),
- można go przenieść w dowolne miejsce — dane i tak trafiają do `%APPDATA%\NightMC`,
- **nie zawiera** plików gry ani modów; wszystko pobiera się dopiero po wybraniu wersji.

---

## Konfiguracja: Microsoft Entra Client ID

Logowanie kont Premium wymaga **własnego** Client ID. NightMC celowo nie zawiera cudzego identyfikatora.

1. Wejdź na <https://entra.microsoft.com> → **Applications** → **App registrations** → **New registration**.
2. Nazwa: dowolna, np. `NightMC Launcher`.
3. **Supported account types**: *Personal Microsoft accounts only* (albo wariant obejmujący konta osobiste).
4. **Redirect URI**: platforma **Mobile and desktop applications**, adres:
   ```text
   http://localhost
   ```
   NightMC uruchamia serwer pętli zwrotnej na losowym porcie; Entra akceptuje dla klientów publicznych dowolny port na `http://localhost`.
5. Po utworzeniu skopiuj **Application (client) ID**.
6. W zakładce **Authentication** ustaw **Allow public client flows** = *Yes*.
7. **Nie twórz** client secret — aplikacja desktopowa jest klientem publicznym i sekret nie może się w niej znaleźć.

Wpisz identyfikator do pliku `.env`:

```dotenv
NIGHTMC_MS_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

Następnie **zbuduj launcher ponownie** — wartość jest wstrzykiwana w czasie budowania (`scripts/build.mjs`, esbuild `define`).

> Dostęp do Minecraft Services (Xbox → XSTS → `api.minecraftservices.com`) bywa dodatkowo reglamentowany przez Mojang/Microsoft. Jeżeli łańcuch zwróci błąd, NightMC pokaże czytelny komunikat wraz z podpowiedzią, a **profile Offline / Non-Premium działają bez tej konfiguracji**.

---

## Konfiguracja: GitHub Releases

```dotenv
NIGHTMC_UPDATE_REPO=twoj-uzytkownik/nightmc
```

NightMC odpytuje `https://api.github.com/repos/<repo>/releases/latest` i szuka w wydaniu plików:

| Plik | Rola |
|---|---|
| `NightMC.exe` | właściwa aktualizacja |
| `NightMC.exe.sha256` | suma kontrolna (**wymagana**) |
| `NightMC.exe.sig` | podpis Ed25519 (opcjonalny) |

Aby włączyć weryfikację podpisu:

```bash
node scripts/gen-update-keys.mjs
```

- **klucz publiczny** → `.env` jako `NIGHTMC_UPDATE_PUBKEY` (trafia do EXE — to jest w porządku),
- **klucz prywatny** → sekret GitHub Actions `NIGHTMC_UPDATE_PRIVKEY` (**nigdy** do repozytorium ani do EXE).

---

## Konfiguracja: aktualności

```dotenv
NIGHTMC_NEWS_URL=https://raw.githubusercontent.com/twoj-uzytkownik/nightmc/main/news.json
```

Format pliku (w repozytorium jest gotowy przykład `news.json`):

```json
{
  "items": [
    {
      "id": "news-1",
      "title": "NightMC 1.0",
      "description": "Pierwsze wydanie launchera.",
      "image": "https://example.com/image.webp",
      "url": "https://example.com/changelog",
      "publishedAt": "2026-01-01T12:00:00Z"
    }
  ]
}
```

NightMC nie renderuje surowego HTML i nie wykonuje JavaScriptu z tej odpowiedzi, waliduje każdy adres (tylko `https`), ogranicza rozmiar do 512 KiB, stosuje timeout i cache. **Brak aktualności nigdy nie blokuje launchera.**

---

## Podpisywanie kodu Windows i SmartScreen

- **Build lokalny działa bez certyfikatu** — po prostu nie ustawiaj zmiennych.
- Build produkcyjny podpiszesz, dodając w GitHub → *Settings* → *Secrets and variables* → *Actions*:
  - `WIN_CSC_LINK` — certyfikat `.pfx` zakodowany w base64,
  - `WIN_CSC_KEY_PASSWORD` — hasło do certyfikatu.
- Certyfikat ani hasło **nie mogą** trafić do repozytorium. Workflow przekazuje je wyłącznie przez `env` i nie wypisuje ich w logach.

**SmartScreen.** Niepodpisany (albo świeżo podpisany) plik będzie początkowo blokowany komunikatem „System Windows ochronił Twój komputer”. To normalne: SmartScreen buduje reputację pliku i wydawcy z czasem. Użytkownik może kliknąć **Więcej informacji → Uruchom mimo to**. Certyfikat EV usuwa ostrzeżenie od razu; zwykły certyfikat OV wymaga zbudowania reputacji.

---

## Gdzie NightMC trzyma dane

```text
%APPDATA%\NightMC\
├─ nightmc.db          baza SQLite (instancje, ustawienia, profile offline, historia)
├─ secrets.bin         zaszyfrowany magazyn (tylko gdy keytar jest niedostępny)
├─ instances\          instancje gry (mody, configi, światy, screenshoty, logi)
├─ runtimes\           środowiska Java pobrane przez NightMC (Temurin)
├─ cache\              cache metadanych
├─ shared\             współdzielone biblioteki, assety i JAR-y klienta
├─ logs\               zapisane logi
└─ temp\               pliki tymczasowe (instalatory, pobierane aktualizacje)
```

Katalogi powstają przy pierwszym uruchomieniu. Katalog instancji można zmienić w **Ustawieniach**. **Obok pliku EXE nie powstaje nic.**

---

## Profile Offline / Non-Premium

Profil offline to pełnoprawny profil, a nie tylko tryb singleplayer. Może:

- pobierać wersje z oficjalnego manifestu Mojang,
- instalować Vanilla, Fabric, Forge i NeoForge,
- pobierać mody z Modrinth, importować `.mrpack` i paczki CurseForge,
- używać resource packów i shaderów,
- grać w singleplayer, przez LAN i **na serwerach z `online-mode=false`**.

Każdy nick otrzymuje **stabilny UUID** zgodny z konwencją Minecrafta (`UUID.nameUUIDFromBytes("OfflinePlayer:" + nick)`, czyli UUID wersji 3 z MD5). Ten sam nick zawsze daje ten sam UUID, więc świat, inwentarz i uprawnienia na serwerze przetrwają usunięcie i ponowne dodanie profilu.

Profil jest wyraźnie oznaczony jako `OFFLINE / NON-PREMIUM` i **nigdy** nie jest pokazywany jako zweryfikowane konto Microsoft. Przy uruchomieniu nie jest przekazywany żaden token wyglądający na premium (`--accessToken 0`).

**O `online-mode`.** Zwykły Server List Ping nie zwraca tej wartości i NightMC nie udaje, że potrafi ją odczytać — to Ty ręcznie oznaczasz zaufany serwer. Jeśli profil offline spróbuje wejść na serwer z `online-mode=true`, serwer odrzuci połączenie, a launcher tego **nie obchodzi**.

Przy pierwszym multiplayerze offline pokazywane jest ostrzeżenie:

> Serwery online-mode=false nie weryfikują tożsamości graczy przez Microsoft. Inna osoba może próbować użyć dowolnej nazwy gracza. Korzystaj wyłącznie z zaufanych serwerów posiadających własne zabezpieczenia.

---

## Import paczek

**Modrinth `.mrpack`** — pełna obsługa: `modrinth.index.json`, pobieranie plików wyłącznie z dozwolonych hostów, weryfikacja SHA-1, rozpakowanie `overrides/` i `client-overrides/`. Możliwy jest też eksport instancji do `.mrpack`.

**CurseForge (lokalny ZIP)** — NightMC **nie zawiera klucza API CurseForge**. Odczytuje `manifest.json`, bezpiecznie rozpakowuje `overrides`, pokazuje listę wymaganych modów i pozwala wskazać brakujące pliki ręcznie. Opcjonalnie możesz wpisać **własny** klucz API w *Ustawieniach* — trafi do magazynu poświadczeń systemu, nigdy do pliku, repozytorium ani EXE.

Każde archiwum przechodzi kontrolę: Zip Slip (`../`, ścieżki absolutne, litery dysków, UNC), dowiązania symboliczne, zarezerwowane nazwy Windows, liczba wpisów, współczynnik kompresji i przewidywany rozmiar po rozpakowaniu — liczony **przed** zapisem czegokolwiek na dysk.

---

## Usuwanie tokenów

- **Konta → usuń profil** — kasuje refresh token i token sesji z magazynu poświadczeń systemu.
- Gdy działa `keytar`: wpisy znajdziesz w *Menedżerze poświadczeń Windows* pod usługą **NightMC** (Panel sterowania → Konta użytkowników → Menedżer poświadczeń → Poświadczenia systemu Windows).
- Gdy używany jest fallback `safeStorage`: usuń plik `%APPDATA%\NightMC\secrets.bin`.
- Tokenów **nie ma** w `nightmc.db`, w żadnym pliku JSON ani w logach — logi są redagowane w momencie zapisu, więc kopiowanie i zapisywanie ich jest bezpieczne.

---

## Zasady bezpieczeństwa

**Okno Electrona**

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
devTools: tylko w trybie deweloperskim
```

- Content Security Policy bez `unsafe-eval`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
- Renderer nie ma dostępu do `ipcRenderer`, `require`, `process`, `fs` ani do poleceń systemowych — wyłącznie do listy kanałów z `src/shared/ipc.ts`.
- **Każdy ładunek IPC jest walidowany** przed użyciem; identyfikatory i nazwy plików nie mogą zawierać separatorów ścieżki ani `..`.
- Blokada nawigacji poza aplikację; linki `https` otwierane w systemowej przeglądarce; `webview` zablokowany.
- Gra uruchamiana przez `spawn` z **tablicą argumentów**, nigdy przez sklejone polecenie `cmd.exe` — to odcina całą klasę błędów typu command injection.
- Ruch wychodzący ograniczony do zamkniętej listy hostów (`ALLOWED_HOSTS`); tylko HTTPS; timeouty i limity rozmiaru odpowiedzi; kontrola hosta również po przekierowaniu.
- Aktualizacje: HTTPS → katalog tymczasowy → weryfikacja SHA-256 → opcjonalny podpis Ed25519 → zatwierdzenie przez użytkownika. **Żaden zdalny skrypt nie jest wykonywany.**
- Brak backendu i telemetrii. NightMC nie wysyła nigdzie haseł, tokenów, logów, listy serwerów, listy modów, nazw katalogów ani danych kont. Pełną listę używanych usług zobaczysz w *O programie → Usługi sieciowe*.

---

## Struktura projektu

```text
nightmc/
├─ src/
│  ├─ main/          proces główny: auth, downloader, instances, java,
│  │                 launcher, minecraft, modloaders, mods, packs,
│  │                 servers, updates, news, db, secrets, net, zipsafe
│  ├─ preload/       minimalny, bezpieczny most IPC
│  ├─ renderer/      React: 13 widoków, komponenty, styl nocny
│  └─ shared/        typy, stałe, kontrakt IPC z walidacją
├─ build/            icon.ico / icon.png / icon.svg (generowane)
├─ tests/            testy Vitest (jednostkowe + end-to-end)
├─ scripts/          build, dev, generowanie ikony, klucze aktualizacji
├─ .github/workflows/release.yml
├─ electron-builder.yml
└─ .env.example
```

---

## Znane ograniczenia

- **Budowanie tylko na Windows.** Target `portable` wymaga narzędzi Windows.
- **Portable EXE nie podmienia sam siebie.** Po pobraniu i weryfikacji aktualizacji NightMC otwiera katalog z nowym plikiem — podmiana jest ręczna i świadoma. Instalator NSIS aktualizuje się normalnie.
- **`online-mode` serwera jest niewykrywalne** przez zwykły ping; oznaczenie jest deklaracją użytkownika.
- **Forge/NeoForge dla 1.13+** uruchamiają procesory instalatora (binary patching). Pierwsza instalacja takiej instancji trwa dłużej i wymaga zainstalowanej Javy zgodnej z wersją gry.
- **Quilt nie jest obsługiwany.**
- **CurseForge bez własnego klucza API** nie pobiera modów automatycznie — to ograniczenie regulaminu CurseForge, nie launchera.
- **Logowanie Microsoft wymaga własnego Client ID** i przyznanego dostępu do Minecraft Services.
- **`keytar` jest archiwalny** (projekt zarchiwizowany na GitHubie) — dlatego jest zależnością opcjonalną z automatycznym fallbackiem na `safeStorage`.
- Skróty na pulpicie działają tylko na Windows.

---

## Publikowanie wersji

```bash
# 1. Podbij wersję w package.json
npm version 1.0.1 --no-git-tag-version

# 2. Zatwierdź i otaguj
git add -A
git commit -m "NightMC 1.0.1"
git tag v1.0.1
git push origin main --tags
```

Workflow `.github/workflows/release.yml` uruchomi się po tagu `v*.*.*` i wykona:

1. checkout, 2. Node.js, 3. `npm ci`, 4. lint, 5. typecheck, 6. testy, 7. build,
8. utworzenie `NightMC.exe`, 9. opcjonalne podpisanie, 10. wygenerowanie SHA-256,
11. utworzenie GitHub Release, 12. dodanie EXE i checksumy.

Sekrety są przekazywane wyłącznie przez `env` i nie pojawiają się w logach.

---

## Zgodność prawna i licencje

- [Minecraft EULA](https://www.minecraft.net/eula)
- [Minecraft Usage Guidelines](https://www.minecraft.net/usage-guidelines)

> **NightMC nie jest oficjalnym produktem Mojang Studios ani Microsoft i nie jest przez nie zatwierdzony.**

Pobieranie i używanie plików gry podlega Minecraft EULA. NightMC nie hostuje, nie dołącza i nie rozprowadza plików gry ani płatnych modów. Logo NightMC (półksiężyc z geometryczną literą „N”) jest oryginalne i nie wykorzystuje żadnych elementów marki Minecraft.

Pełna lista licencji bibliotek i źródeł danych jest wbudowana w aplikację: **O programie → Licencje**. Kod NightMC jest udostępniony na licencji MIT (`LICENSE`).
