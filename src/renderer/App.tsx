import { useEffect } from 'react';
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
import { Logo } from './components/Logo.js';

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

  useEffect(() => {
    const off = installEventBridge();
    void bootstrap();
    return off;
  }, [bootstrap]);

  const Page = PAGES[page] ?? HomePage;

  return (
    <>
      <StarField />
      {!ready ? (
        <div style={{ position: 'relative', zIndex: 1, display: 'grid', placeItems: 'center', height: '100vh' }}>
          <div style={{ textAlign: 'center' }}>
            <Logo size={84} />
            <p style={{ color: 'var(--text-dim)', marginTop: 18, letterSpacing: 2 }}>NIGHTMC</p>
          </div>
        </div>
      ) : (
        <div className="app">
          <Sidebar />
          <main className="main">
            <Page />
          </main>
        </div>
      )}

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
