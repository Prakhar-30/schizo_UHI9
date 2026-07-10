import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Backdrop from './Backdrop'
import Navbar from './Navbar'
import Footer from './Footer'

export default function Layout() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <Backdrop />
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
