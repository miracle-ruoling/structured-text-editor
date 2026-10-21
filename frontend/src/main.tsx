import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import App from './App';
import './styles/app.css';

const NativeWorkspace = lazy(() => import('./components/NativeWorkspace'));
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('mode') === 'native'
  ? <Suspense fallback={<main className="loading-screen">正在打开原生写作…</main>}><NativeWorkspace /></Suspense> : <App />);
