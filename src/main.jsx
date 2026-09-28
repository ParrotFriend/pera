import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/onest';
import '@fontsource-variable/bricolage-grotesque';
import pesoFontUrl from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2?url';

// Onest has no ₱ glyph and some phones' system fonts don't either, so ₱ always comes from a bundled font.
try {
  const peso = new FontFace('PesoSign', `url(${pesoFontUrl}) format('woff2')`, { unicodeRange: 'U+20B1', weight: '100 900' });
  document.fonts.add(peso);
  peso.load().catch(() => {});
} catch { /* very old browser: falls back to system fonts */ }
import './styles/index.css';
import App from './App.jsx';

// Ask the browser to keep IndexedDB data even under storage pressure.
navigator.storage?.persist?.().catch(() => {});

class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[pera] UI error', error?.message); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui', textAlign: 'center' }}>
        <div><p style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong. Your data is safe.</p>
          <button style={{ marginTop: 16, padding: '10px 18px', borderRadius: 12, background: '#141B3C', color: '#fff' }} onClick={() => location.reload()}>Reload Pera</button></div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Boundary><App /></Boundary></React.StrictMode>
);
