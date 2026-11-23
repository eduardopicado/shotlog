import { NavLink, Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home';
import { Coffees } from './pages/Coffees';
import { CoffeeDetailPage } from './pages/CoffeeDetail';
import { CoffeeFormPage } from './pages/CoffeeForm';
import { LogShot, PickCoffee } from './pages/LogShot';
import { ShotPage } from './pages/ShotPage';
import { RecipeFormPage } from './pages/RecipeForm';
import { Settings } from './pages/Settings';

export function App() {
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
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<main className="page"><h1>Not found</h1></main>} />
      </Routes>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><span aria-hidden>⌂</span>Home</NavLink>
        <NavLink to="/coffees"><span aria-hidden>☕</span>Coffees</NavLink>
        <NavLink to="/shot" className="tab-primary"><span aria-hidden>＋</span>Shot</NavLink>
        <NavLink to="/settings"><span aria-hidden>⚙</span>Settings</NavLink>
      </nav>
    </div>
  );
}
