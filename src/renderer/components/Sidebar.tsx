/** Nawigacja boczna. */

import { Logo } from './Logo.js';
import { call } from '../api.js';
import { useStore, type PageId } from '../store/useStore.js';
import {
  IconCpu, IconGrid, IconHome, IconInfo, IconLayers, IconPackage, IconPlus,
  IconPuzzle, IconServer, IconSettings, IconTerminal, IconUser,
} from './Icons.js';

interface Entry {
  id: PageId;
  label: string;
  icon: JSX.Element;
  group: string;
}

const ENTRIES: Entry[] = [
  { id: 'home', label: 'Strona główna', icon: <IconHome />, group: 'Gra' },
  { id: 'instances', label: 'Biblioteka', icon: <IconGrid />, group: 'Gra' },
  { id: 'wizard', label: 'Nowa instancja', icon: <IconPlus />, group: 'Gra' },
  { id: 'servers', label: 'Serwery', icon: <IconServer />, group: 'Gra' },

  { id: 'versions', label: 'Wersje Minecrafta', icon: <IconLayers />, group: 'Zawartość' },
  { id: 'loaders', label: 'Modloadery', icon: <IconLayers />, group: 'Zawartość' },
  { id: 'mods', label: 'Mody', icon: <IconPuzzle />, group: 'Zawartość' },
  { id: 'packs', label: 'Import paczek', icon: <IconPackage />, group: 'Zawartość' },

  { id: 'accounts', label: 'Konta', icon: <IconUser />, group: 'System' },
  { id: 'java', label: 'Java i RAM', icon: <IconCpu />, group: 'System' },
  { id: 'settings', label: 'Ustawienia', icon: <IconSettings />, group: 'System' },
  { id: 'logs', label: 'Logi', icon: <IconTerminal />, group: 'System' },
  { id: 'about', label: 'O programie', icon: <IconInfo />, group: 'System' },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const instances = useStore((s) => s.instances);
  const update = useStore((s) => s.update);

  let lastGroup = '';

  return (
    <nav className="sidebar">
      <div className="brand">
        <Logo size={36} />
        <div>
          <div className="brand-name">Night<span>MC</span></div>
          <div className="brand-sub">Launcher</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {ENTRIES.map((entry) => {
          const showGroup = entry.group !== lastGroup;
          lastGroup = entry.group;
          return (
            <div key={entry.id}>
              {showGroup && <div className="nav-group">{entry.group}</div>}
              <button
                className={`nav-item${page === entry.id ? ' active' : ''}`}
                onClick={() => setPage(entry.id)}
              >
                <span className="nav-icon">{entry.icon}</span>
                <span>{entry.label}</span>
                {entry.id === 'instances' && instances.length > 0 && <span className="nav-badge">{instances.length}</span>}
                {entry.id === 'about' && update?.available && <span className="nav-badge">!</span>}
              </button>
            </div>
          );
        })}
      </div>

      <div className="sidebar-author">
        Author:{' '}
        <button
          className="sidebar-author-link"
          onClick={() => void call('app:openExternal', { url: 'https://github.com/Gramolis' }).catch(() => undefined)}
        >
          Krzychu
        </button>
      </div>
    </nav>
  );
}
