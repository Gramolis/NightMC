import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');

/**
 * Warstwa intro (`#boot-intro`) jest już na ekranie - wstawia ją index.html,
 * więc animacja startuje przed pobraniem tego bundle'a. Usuwa ją dopiero
 * `StartupIntro` w `useLayoutEffect`, czyli przed pierwszym malowaniem Reacta.
 *
 * Gdyby montowanie Reacta wywróciło się na starcie, użytkownik zostałby
 * z intro i napisem "Ładowanie NightMC…" bez końca - dlatego w takim wypadku
 * podmieniamy komunikat na czytelny błąd zamiast zostawiać go w nieskończoność.
 */
try {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (err) {
  const status = document.querySelector('#boot-intro .nm-intro__status');
  if (status) status.textContent = 'Nie udało się uruchomić NightMC. Sprawdź logi aplikacji.';
  throw err;
}
