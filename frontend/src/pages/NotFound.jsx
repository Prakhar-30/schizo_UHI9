import Button from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-4 text-center">
      <div>
        <p className="font-black text-8xl tracking-tight">
          4<span className="text-yield">0</span>
          <span className="text-risk">4</span>
        </p>
        <p className="mt-4 font-mono text-sm uppercase tracking-[0.3em] text-bone/40">page not found</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button to="/" variant="bone" size="md">
            ← Home
          </Button>
          <Button to="/markets" variant="outline" size="md">
            Markets
          </Button>
        </div>
      </div>
    </div>
  )
}
