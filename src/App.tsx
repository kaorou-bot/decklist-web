import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import EventsPage from './pages/EventsPage'
import MetaPage from './pages/MetaPage'
import SearchPage from './pages/SearchPage'
import DeckDetailPage from './pages/DeckDetailPage'
import CollectionPage from './pages/CollectionPage'
import DeckEditorPage from './pages/DeckEditorPage'
import { useFormats } from './lib/formats'

const tabs = [
  { to: '/', label: '最新赛事' },
  { to: '/meta', label: '单卡使用率' },
  { to: '/search', label: '查牌' },
  { to: '/custom', label: '套牌集' },
]

export default function App() {
  const { formats, defaultFormat } = useFormats()

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">MTG 套牌</span>
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) => `navtab${isActive ? ' active' : ''}`}
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="app">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/meta" element={<MetaPage formats={formats} defaultFormat={defaultFormat} />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/deck/:id" element={<DeckDetailPage />} />
          <Route path="/custom" element={<CollectionPage />} />
          <Route path="/custom/:id" element={<DeckEditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
