import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Link, Navigate, useLocation } from 'react-router-dom';
import { Map, Globe, LogOut, LogIn, Loader, Menu, X, UserCog } from 'lucide-react';
import Logo, { LogoMark } from './components/Logo';
import { useTranslation } from 'react-i18next';
import Home from './pages/Home';
import SubmitComplaint from './pages/SubmitComplaint';
import TrackComplaint from './pages/TrackComplaint';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TicketDetails from './pages/TicketDetails';
import Analytics from './pages/Analytics';
import MapView from './pages/MapView';
import ChatWidget from './components/ChatWidget';
import AskPcmc from './pages/AskPcmc';
import KnowledgeBase from './pages/KnowledgeBase';
import Transparency from './pages/Transparency';
import Account from './pages/Account';
import FieldStaff from './pages/FieldStaff';
import Skyline from './components/Skyline';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MetaProvider, useMeta } from './context/MetaContext';

// Officer pages require a login; citizens are sent to the login page and brought back afterwards.
function OfficerRoute({ children }) {
  const { officer, checking } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  if (checking) return <div className="page-loading"><Loader className="spin" size={28} /> {t('loading')}</div>;
  if (!officer) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

// The citizen assistant appears on citizen pages only.
const CHAT_PAGES = ['/', '/report', '/track'];

function Shell() {
  const { t, i18n } = useTranslation();
  const { officer, logout } = useAuth();
  const { corporation } = useMeta();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // New page: close the mobile menu and start at the top.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className={`app-shell ${pathname === '/' ? 'is-home' : ''}`}>
      <header className={`site-header ${scrolled ? 'scrolled' : ''} ${menuOpen ? 'menu-open' : ''} ${officer ? 'is-officer' : ''}`}>
        <nav className="navbar">
          <Link className="brand" to="/" aria-label={t('brand')}>
            <Logo />
          </Link>
          <button type="button" className="menu-toggle" aria-label={t('menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="nav-links">
            <NavLink to="/" end>{t('nav_home')}</NavLink>
            <NavLink to="/report">{t('nav_submit')}</NavLink>
            <NavLink to="/track">{t('nav_track')}</NavLink>
            <NavLink to="/ask">{t('nav_ask')}</NavLink>
            <NavLink to="/transparency">{t('nav_transparency')}</NavLink>
            {officer && (
              <>
                <NavLink to="/dashboard">{t('nav_dashboard')}</NavLink>
                <NavLink to="/map" className="nav-icon-link">
                  <Map size={14}/> {t('nav_map')}
                </NavLink>
                <NavLink to="/analytics">{t('nav_analytics')}</NavLink>
                <NavLink to="/knowledge">{t('nav_knowledge')}</NavLink>
                <NavLink to="/account" className="nav-icon-link" title={t('nav_account')}><UserCog size={14} /> {t('nav_account')}</NavLink>
              </>
            )}

            <label className="lang-switch">
              <Globe size={14} />
              <select aria-label={t('language')} value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="hi">हिंदी</option>
                <option value="mr">मराठी</option>
              </select>
            </label>

            {officer ? (
              <button type="button" className="nav-auth nav-logout" onClick={logout} title={`${t('logout')} (${officer.email})`} aria-label={t('logout')}>
                <LogOut size={15} /> <span className="nav-auth-text">{t('logout')}</span>
              </button>
            ) : (
              <NavLink to="/login" className="nav-auth"><LogIn size={14} /> {t('officer_login')}</NavLink>
            )}
          </div>
        </nav>
      </header>
      {/* Keyed by path so each page plays the enter transition. */}
      <main key={pathname} className="page-transition">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<SubmitComplaint />} />
          <Route path="/track" element={<TrackComplaint />} />
          <Route path="/ask" element={<AskPcmc />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<OfficerRoute><Dashboard /></OfficerRoute>} />
          <Route path="/map" element={<OfficerRoute><MapView /></OfficerRoute>} />
          <Route path="/analytics" element={<OfficerRoute><Analytics /></OfficerRoute>} />
          <Route path="/knowledge" element={<OfficerRoute><KnowledgeBase /></OfficerRoute>} />
          <Route path="/account" element={<OfficerRoute><Account /></OfficerRoute>} />
          <Route path="/staff" element={<OfficerRoute><FieldStaff /></OfficerRoute>} />
          <Route path="/ticket/:id" element={<OfficerRoute><TicketDetails /></OfficerRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <div className="footer-skyline" aria-hidden="true"><Skyline variant="line" interactive={false} /></div>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <LogoMark size={28} />
            <strong>{t('brand')}</strong>
          </div>
          <nav className="footer-links">
            <Link to="/report">{t('nav_submit')}</Link>
            <Link to="/track">{t('nav_track')}</Link>
            <Link to="/ask">{t('nav_ask')}</Link>
            <Link to="/transparency">{t('nav_transparency')}</Link>
            <a href={`tel:${corporation?.sarathiHelpline || '8888006666'}`}>Sarathi {corporation?.sarathiHelpline || '8888006666'}</a>
            {corporation?.website && <a href={corporation.website} target="_blank" rel="noreferrer">pcmcindia.gov.in</a>}
          </nav>
        </div>
        <p className="footer-note">{t('footer_disclaimer', { helpline: corporation?.sarathiHelpline || '8888006666' })} pcmcindia.gov.in</p>
      </footer>
      {CHAT_PAGES.includes(pathname) && <ChatWidget />}
    </div>
  );
}

function App() {
  return (
    <Router>
      <MetaProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </MetaProvider>
    </Router>
  );
}

export default App;
