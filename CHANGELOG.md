# Changelog NightMC

W tym pliku zapisujemy najważniejsze zmiany widoczne dla użytkowników. Projekt stosuje format
[Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), a wersje wydań są zgodne z tagami GitHub.

## [Unreleased]

## [1.0.4] — 2026-08-25

### Dodano

- Dodano intro.
- Procentowy postęp pobierania wybranej wersji paczki wraz z rozmiarem, prędkością i przewidywanym czasem zakończenia.
- Dynamiczną czerwoną strefę suwaka RAM powyżej bezpiecznego maksimum komputera; wartości z tej strefy nie mogą zostać zapisane.
- Diagnostykę lokalnych modów odczytującą bez uruchamiania kodu metadane Fabric, Forge, NeoForge, Quilt i starszego Forge.
- Wykrywanie duplikatów, złego loadera, brakujących lub niezgodnych zależności, konfliktów, uszkodzonych JAR-ów i podejrzanych archiwów.
- Panel „Sprawdź mody” w zakładce modów z podsumowaniem błędów, ostrzeżeń i sugerowanymi rozwiązaniami.

### Zmieniono

- Publiczne wydania zawierają teraz instalator zamiast przenośnego EXE, a aktualizator NightMC pobiera i weryfikuje instalator kolejnej wersji.
- Po zatwierdzeniu aktualizacji NightMC automatycznie zamyka się, podmienia pliki przez zweryfikowany instalator i uruchamia nową wersję.

### Naprawiono

- Wartości RAM poniżej rekomendacji nie są już błędnie opisywane jako „Powyżej rekomendacji”.

## [1.0.3] — 2026-08-24

### Dodano

- Wbudowany ekran changeloga w NightMC, automatycznie synchronizowany z `CHANGELOG.md` na GitHubie.
- Ręczne odświeżanie changeloga oraz zapisaną kopię używaną przy braku internetu.
- Automatyczne tworzenie kompletnej instancji z lokalnego ZIP-a CurseForge na podstawie wersji gry i loadera z manifestu.
- Czerwony przycisk „Anuluj” przy imporcie paczki, który zamyka podgląd i czyści wybrany plik bez tworzenia instancji.

### Zmieniono

- Import ZIP nie tworzy już pustej instancji, gdy brakuje klucza CurseForge lub ręcznie wskazanych modów.
- Archiwa bez manifestu, loadera albo zawartości modów pokazują trwałą instrukcję ręcznego utworzenia instancji i skopiowania folderów `mods` oraz `config`.

### Naprawiono

- Import ZIP-ów CurseForge zawierających `mods/`, `config` i pozostałą zawartość bezpośrednio w katalogu głównym archiwum.
- Wczytywanie dołączonych modów zarówno z `mods/`, jak i `overrides/mods/`, także gdy nazwa folderu używa wielkich liter.

## [1.0.1] — 2026-08-24

### Dodano

- Wyszukiwarkę gotowych paczek modów z Modrinth i CurseForge w kreatorze paczek.
- Pobieranie wybranej wersji paczki bezpośrednio jako nowej instancji NightMC.
- Widok zawartości pobranej paczki z możliwością dodawania modów z obu katalogów.
- Usuwanie, wyłączanie, włączanie i aktualizowanie pojedynczych modów paczki.
- Rozpoznawanie źródła modów CurseForge oraz aktualizowanie ich, gdy API udostępnia nowszy zgodny plik.
- Kreator własnej mieszanej paczki łączącej mody z Modrinth i CurseForge.
- Przycisk „Napraw” dla instancji, który sprawdza pliki gry, loadera oraz zaimportowanej paczki i pobiera brakujące elementy.
- Automatyczne wykrywanie pamięci komputera oraz suwak RAM z rekomendacją zależną od rodzaju i wielkości instancji.
- Kolorowy wskaźnik wykorzystania RAM i oznaczenie wartości „Optymalne” w stylu NightMC.

### Zmieniono

- Aktualizacja moda zastępuje poprzedni plik zamiast pozostawiać dwie wersje w katalogu `mods`.
- Import CurseForge zapisuje identyfikatory projektu i pliku, dzięki czemu NightMC może później szukać aktualizacji.
- Katalog CurseForge wykrywa sekcję paczek przez API, z zachowaniem zgodnego identyfikatora awaryjnego.
- Informacja o własnym Microsoft Client ID pozostaje w README i nie jest pokazywana odbiorcy gotowego launchera.
- Panel tworzenia instancji oraz podpis autora otrzymały poprawiony układ interfejsu.

### Naprawiono

- Instalację Forge z paczek modów: NightMC kopiuje artefakty osadzone w instalatorze i odtwarza brakujący profil loadera.
- Błąd uruchomienia Forge `Cannot find launch target fmlclient` po imporcie niektórych paczek.
- Naprawę i ponowne pobieranie plików wymaganych przez paczki Modrinth oraz CurseForge.
- Pobieranie Javy i aktualizacji po przekierowaniu GitHub na `release-assets.githubusercontent.com`.
- Redagowanie podpisanych adresów GitHub w logach, aby parametry tymczasowych tokenów nie były ujawniane.

## [1.0.0] — 2026-08-24

### Dodano

- Pierwsze publiczne wydanie NightMC dla Windows 10/11 x64.
- Profile Microsoft Premium oraz Offline / Non-Premium.
- Osobne instancje Vanilla, Fabric, Forge i NeoForge.
- Import paczek Modrinth `.mrpack` i lokalnych archiwów CurseForge ZIP.
- Automatyczne pobieranie Javy Eclipse Temurin, plików gry, bibliotek i assetów.
- Aktualizacje i aktualności z repozytorium GitHub.
- Logi, diagnostykę uruchomienia, kopie zapasowe i eksport instancji.

[Unreleased]: https://github.com/Gramolis/NightMC/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/Gramolis/NightMC/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Gramolis/NightMC/compare/v1.0.1...v1.0.3
[1.0.1]: https://github.com/Gramolis/NightMC/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Gramolis/NightMC/releases/tag/v1.0.0
