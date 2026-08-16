import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="auth-wrapper" style={{ flexDirection: 'column', textAlign: 'center' }}>
      <div className="bg-blob blob-1"></div>
      <div className="bg-blob blob-2"></div>

      <div style={{ zIndex: 10, maxWidth: '600px' }}>
        <h1 className="auth-title" style={{ fontSize: '3rem', marginBottom: '1rem' }}>
          Olympiad Portal
        </h1>
        <p className="auth-subtitle" style={{ fontSize: '1.2rem', marginBottom: '3rem' }}>
          The ultimate platform for schools, educators, and students to compete and manage olympiads seamlessly.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <Link href="/login" className="btn btn-secondary">
            Sign In
          </Link>
          <Link href="/signup" className="btn btn-primary">
            Get Started (Organiser)
          </Link>
        </div>
      </div>
    </div>
  );
}
