import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import Create from './pages/Create'
import Hunt from './pages/Hunt'
import Markets from './pages/Markets'
import Dashboard from './pages/Dashboard'
import About from './pages/About'
import Leaderboard from './pages/Leaderboard'
import PositionDetail from './pages/PositionDetail'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/hunt" element={<Hunt />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/leaders" element={<Leaderboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/positions/:id" element={<PositionDetail />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
