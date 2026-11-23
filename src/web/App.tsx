import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { Coffees } from './pages/Coffees';
import { CoffeeDetailPage } from './pages/CoffeeDetail';
import { CoffeeFormPage } from './pages/CoffeeForm';
import { LogShot, PickCoffee } from './pages/LogShot';
import { ShotPage } from './pages/ShotPage';
import { RecipeFormPage } from './pages/RecipeForm';
import { Settings } from './pages/Settings';
import { Compare } from './pages/Compare';

export function App() {
  // Logging a shot lives under /coffees/:id/shot, but belongs to the Shot tab.
  const loggingShot = /^\/(coffees\/\d+\/)?shot$/.test(useLocation().pathname);
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/coffees" element={<Coffees />} />
        <Route path="/coffees/new" element={<CoffeeFormPage />} />
        <Route path="/coffees/:id" element={<CoffeeDetailPage />} />
        <Route path="/coffees/:id/edit" element={<CoffeeFormPage />} />
        <Route path="/coffees/:id/shot" element={<LogShot />} />
        <Route path="/coffees/:id/recipe" element={<RecipeFormPage />} />
        <Route path="/shot" element={<PickCoffee />} />
        <Route path="/shots/:id" element={<ShotPage />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<main className="page"><h1>Not found</h1></main>} />
      </Routes>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><span aria-hidden>⌂</span>Home</NavLink>
        <NavLink to="/coffees" className={({ isActive }) => (isActive && !loggingShot ? 'active' : '')}><span aria-hidden>☕</span>Coffees</NavLink>
        <NavLink to="/shot" className={({ isActive }) => `tab-primary${isActive || loggingShot ? ' active' : ''}`}><span aria-hidden>＋</span>Shot</NavLink>
        <NavLink to="/settings"><span aria-hidden>⚙</span>Settings</NavLink>
      </nav>
    </div>
  );
}
