// Fixed, behind-everything atmosphere: grid + drifting color blobs + grain.
export default function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 grid-bg mask-fade-b opacity-60" />

      <div className="absolute -left-40 top-[-10%] h-[42rem] w-[42rem] rounded-full bg-volt/20 blur-[140px] animate-blob" />
      <div
        className="absolute right-[-15%] top-[20%] h-[34rem] w-[34rem] rounded-full bg-risk/15 blur-[150px] animate-blob"
        style={{ animationDelay: '-6s' }}
      />
      <div
        className="absolute bottom-[-20%] left-[30%] h-[36rem] w-[36rem] rounded-full bg-mint/10 blur-[150px] animate-blob"
        style={{ animationDelay: '-12s' }}
      />

      <div className="absolute inset-0 bg-noise opacity-[0.025] mix-blend-soft-light" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/0 via-ink/0 to-ink" />
    </div>
  )
}
