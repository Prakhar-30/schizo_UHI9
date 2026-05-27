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

export default function Logo({ size = 72 }) {
  const textHeight = Math.max(12, Math.round(size * 2))

  return (
    <Link to="/" className="group flex items-center">
      <Mark size={size} />
      <img src="/logotext.png" alt="schizō" style={{ height: `${textHeight}px` }} className="object-contain" />
    </Link>
  )
}
