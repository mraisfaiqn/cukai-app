import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import cukaiLogo from '../../assets/cukai-logo.png';


// crossed-out eye icons for show/hide password toggle
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"
      stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round"
    />
  </svg>
);

// eye open when password visible
const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
      stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round"
    />
    <circle cx="12" cy="12" r="3" stroke="#94A3B8" strokeWidth="1.8" />
  </svg>
);


export default function LoginPanel({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 1. Fake API call or actual auth logic here
      await new Promise((resolve) => setTimeout(resolve, 1500)); 
      // 2. Trigger the parent state change (setIsAuthenticated(true))
      onLogin(); 
      // 3. Redirect to the overview page now that they are logged in
      navigate("/overview"); 
    } catch (error) {
      console.error("Login failed", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-[42%] h-screen bg-[#E8ECF4] flex items-center justify-center px-8 flex-shrink-0">
      <div className="w-full max-w-[340px] bg-white rounded-[20px] shadow-[0_4px_32px_rgba(15,23,42,0.10)] px-9 py-10 flex flex-col">
        {/* Logo and heading */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <img
            src={cukaiLogo}
            alt="Cukai.ai logo"
            className="h-10 w-10 shrink-0"
          />
          <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
            cukai
          <span className="text-[#10B981]">.</span>
          <span className="font-light text-[#64748B]">ai</span>
          </span>
        </div>
        <p className="text-center text-[13px] text-[#94A3B8] mb-8 mt-3">
          Sign in to continue
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email/username */}
          <div>
            <label className="block text-[11px] font-semibold tracking-[0.06em] uppercase text-[#6B7280] mb-2">
              Username or Email Address
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              className="w-full px-4 py-3 rounded-xl border-[1.5px] border-[#E2E8F0] text-[13.5px] text-[#0F172A] bg-white outline-none focus:border-[#10B981] transition-colors placeholder-[#D1D5DB]"
            />
          </div>
          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#6B7280]">
                Password
              </label>
              <a
                href="#"
                className="text-[12.5px] text-[#0D9488] font-semibold no-underline hover:opacity-80 transition-opacity"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-3 pr-11 rounded-xl border-[1.5px] border-[#E2E8F0] text-[13.5px] text-[#0F172A] bg-white outline-none focus:border-[#10B981] transition-colors placeholder-[#D1D5DB]"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-0 flex items-center"
              >
                {showPass ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </div>
          </div>
          {/* Remember Me */}
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="rememberMe"
              className="w-4 h-4 rounded border-[1.5px] border-[#E2E8F0] accent-[#10B981] cursor-pointer"
            />
            <label
              htmlFor="rememberMe"
              className="text-[13px] text-[#6B7280] cursor-pointer select-none"
            >
              Remember Me
            </label>
          </div>
          {/* Sign in button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-[#10B981] hover:bg-[#0D9488] text-white text-[15px] font-bold border-none cursor-pointer shadow-[0_4px_18px_rgba(16,185,129,0.38)] transition-colors disabled:opacity-75 disabled:cursor-not-allowed mt-2"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {/*form closes/}
        {/* Spacer that push bottom part down and makes card taller */}
        <div className="flex-1 min-h-[48px]" />
        {/* Divider */}
        <div className="border-t border-[#F1F5F9] mb-5" />
        {/* Sign up link */}
        <p className="text-center text-[13px] text-[#64748B]">
          New to Cukai.AI?{" "}
          <NavLink
            to="/getstarted"
            className="text-[#0F172A] font-semibold underline underline-offset-2 hover:text-[#0D9488] transition-colors"
          >
            Create an account.
          </NavLink>
        </p>
      </div>
    </div>
  );
}