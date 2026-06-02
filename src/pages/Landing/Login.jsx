import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function Login({ onLogin }) {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [status, setStatus] = useState(null); // null | 'success' | 'error'
  const navigate = useNavigate();

  const handleSignIn = () => {
    if (authEnabled) {
      setStatus('success');
      onLogin(); // lift auth state up to App.jsx
      setTimeout(() => navigate('/overview'), 900);
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">

        {/* Headings */}
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-[#0F172A]">
            Login / Sign up
          </h2>
          <h3 className="mt-2 text-sm font-normal text-[#64748B]">
            Welcome back! Sign in to access your dashboard.
          </h3>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">

          {/* Auth toggle row */}
          <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-100 bg-[#f8fafc] px-4 py-3">
            <span className="text-sm font-semibold text-[#0F172A]">Auth</span>
            <button
              onClick={() => {
                setAuthEnabled(prev => !prev);
                setStatus(null);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                authEnabled ? 'bg-[#10B981]' : 'bg-slate-200'
              }`}
              aria-pressed={authEnabled}
              aria-label="Toggle authentication"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                  authEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Email field (decorative) */}
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-[#64748B]">
              Email address
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#0F172A] placeholder-slate-300 outline-none transition-colors duration-150 focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981]"
            />
          </div>

          {/* Password field (decorative) */}
          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-medium text-[#64748B]">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#0F172A] placeholder-slate-300 outline-none transition-colors duration-150 focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981]"
            />
          </div>

          {/* Sign In button */}
          <button
            onClick={handleSignIn}
            className="w-full rounded-lg border-[1.5px] border-[#10B981] bg-[#10B981] py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:border-[#0D9488] hover:bg-[#0D9488] active:scale-[0.98]"
          >
            Sign In
          </button>

          {/* Status label */}
          {status === 'success' && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-[#10B981]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Login successful — redirecting…
            </p>
          )}
          {status === 'error' && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-[#EF4444]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Incorrect login details. Please try again.
            </p>
          )}

        </div>
      </div>
    </div>
  );
}

export default Login;