import { useState, useEffect } from 'react';
import LandingPage from './LandingPage';
import StudioApp from './StudioApp';

export function App() {
  const [currentRoute, setCurrentRoute] = useState<string>(() => {
    // Support both pathname-based routing and hash-based fallback (e.g. for static servers)
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (path === '/studio' || hash === '#studio') {
        return '/studio';
      }
    }
    return '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      if (path === '/studio' || hash === '#studio') {
        setCurrentRoute('/studio');
      } else {
        setCurrentRoute('/');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToStudio = () => {
    if (window.location.pathname !== '/studio') {
      window.history.pushState({}, '', '/studio');
    }
    setCurrentRoute('/studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToHome = () => {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setCurrentRoute('/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (currentRoute === '/studio') {
    return <StudioApp onNavigateHome={navigateToHome} />;
  }

  return <LandingPage onNavigateStudio={navigateToStudio} />;
}

export default App;
