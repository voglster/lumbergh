import { Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import SessionDetail from './pages/SessionDetail'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/session/:name" element={<SessionDetail />} />
    </Routes>
  )
}

export default App
