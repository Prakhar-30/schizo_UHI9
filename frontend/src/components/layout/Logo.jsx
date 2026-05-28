import { Link } from 'react-router-dom'

export function Mark({ size = 86 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" className="shrink-0">
      <clipPath id="lm">
        <circle cx="32" cy="32" r="22" />
      </clipPath>
      <image href="logo.png" width="128" height="128" />
    </svg>
  )
}

export default function Logo() {
  return (
    <Link to="/" className="group flex shrink-0 items-center">
      {/* Mark: scales down on mobile so the navbar (h-16) doesn't overflow. */}
      <svg
        className="h-9 w-9 shrink-0 sm:h-12 sm:w-12"
        viewBox="0 0 128 128"
        fill="none"
      >
        <image href="logo.png" width="128" height="128" />
      </svg>
      <img
        src="/logotext.png"
        alt="schizō"
        className="h-10 w-auto object-contain sm:h-14"
      />
    </Link>
  )
}
