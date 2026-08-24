import { useCallback, useEffect, useState } from 'react';
import { StarField } from './components/StarField.js';
import { Sidebar } from './components/Sidebar.js';
import { installEventBridge, useStore } from './store/useStore.js';

import { HomePage } from './pages/HomePage.js';
import { InstancesPage } from './pages/InstancesPage.js';
import { WizardPage } from './pages/WizardPage.js';
import { VersionsPage } from './pages/VersionsPage.js';
import { LoadersPage } from './pages/LoadersPage.js';
import { ModsPage } from './pages/ModsPage.js';
import { PacksPage } from './pages/PacksPage.js';
import { ServersPage } from './pages/ServersPage.js';
import { AccountsPage } from './pages/AccountsPage.js';
import { JavaPage } from './pages/JavaPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { LogsPage } from './pages/LogsPage.js';
import { AboutPage } from './pages/AboutPage.js';
import { StartupIntro } from './components/StartupIntro.js';

const PAGES = {
  home: HomePage,
  instances: InstancesPage,
  wizard: WizardPage,
  versions: VersionsPage,
  loaders: LoadersPage,
  mods: ModsPage,
  packs: PacksPage,
  servers: ServersPage,
  accounts: AccountsPage,
  java: JavaPage,
  settings: SettingsPage,
  logs: LogsPage,
  about: AboutPage,
} as const;

export function App() {
  const page = useStore((s) => s.page);
  const ready = useStore((s) => s.ready);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const bootstrap = useStore((s) => s.bootstrap);

  /** Intro jest nakładką: bootstrap leci równolegle i nic go nie blokuje. */
  const [introDone, setIntroDone] = useState(false);
  const handleIntroFinish = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    const off = installEventBridge();
    void bootstrap();
    return off;
  }, [bootstrap]);

  const Page = PAGES[page] ?? HomePage;

  return (
    <>
      <StarField />
      {/* Menu montuje się od razu po zakończeniu bootstrapu - jeszcze pod
          nieprzezroczystą nakładką intro. Dzięki temu w chwili odsłonięcia
          jest już gotowe i nie widać ani migania, ani przeskoku układu. */}
      {ready && (
        <div className={`app${introDone ? '' : ' app--revealing'}`}>
          <Sidebar />
          <main className="main">
            <Page />
          </main>
        </div>
      )}

      {!introDone && <StartupIntro ready={ready} onFinish={handleIntroFinish} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
