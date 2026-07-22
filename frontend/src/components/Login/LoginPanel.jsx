import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import cukaiLogo from '../../assets/cukai-logo.png';
import { userLogin } from "../../services/api";


// buka/tutup password eye icon
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"
      stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round"
    />
  </svg>
);

// eye open when password shown
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

  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(""); // Clear previous errors

    try {
      // 1. Fire network request to your FastAPI login endpoint
      const response = await userLogin(email, password);

      // Clear any stale per-user state left behind by a previous session in this
      // browser BEFORE writing the new user's identity. Without this, logging in
      // as a second account can silently reuse the first account's activeEntityId,
      // making ManageProfile/Overview show the wrong entity's data.
      localStorage.removeItem("activeEntityId");
      // Same reasoning for CukaiBot.jsx's per-entity "last active chat session"
      // keys (cukaiActiveSessionId:<entityId>) — swept by prefix since there
      // can be one per entity the previous account had open, not a single key.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("cukaiActiveSessionId:")) localStorage.removeItem(key);
      }

      if (response && response.id) {
        localStorage.setItem("userId", String(response.id));
        localStorage.setItem("userFullName", response.fullName || "");
        localStorage.setItem("userEmail", email);
      }

      onLogin();
      navigate("/overview");
    } catch (err) {
      console.error("Login process caught error:", err);
      
      // Look for the clean error description passed back from your FastAPI backend
      const serverMessage = err.response?.data?.detail || "Invalid email or password layout.";
      setError(serverMessage);
    } finally {
      // This will force the button to drop "Logging in..." and become clickable again!
      setLoading(false);
    }
  };

  return (
    <div className="w-[50%] h-screen bg-background flex items-center justify-center px-8 flex-shrink-0">
      <div className="w-full max-w-[340px] bg-surface rounded-[20px] shadow-[0_4px_32px_rgba(15,23,42,0.10)] px-9 py-10 flex flex-col">
        {/* Logo and heading */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <img
            src={cukaiLogo}
            alt="Cukai.ai logo"
            className="h-10 w-10 shrink-0"
          />
          <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
            cuk<span className="font-light text-[#64748B]">ai</span>
          </span>
        </div>
        <p className="text-center text-xs text-[#94A3B8] mb-8 mt-3">
          Log In to Continue
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email/username */}
          <div>
            <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">
              Email Address
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-[#0F172A] bg-surface outline-none focus:border-primary transition-colors placeholder-[#CBD5E1]"
            />
          </div>
          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold tracking-[0.06em] text-muted">
                Password
              </label>
              <a
                href="#"
                className="text-xs text-primary font-semibold no-underline hover:opacity-80 transition-opacity"
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
                className="w-full px-4 py-3 pr-11 rounded-xl border-[1.5px] border-border text-[13.5px] text-[#0F172A] bg-surface outline-none focus:border-primary transition-colors placeholder-[#CBD5E1]"
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
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 text-critical rounded-xl text-xs font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>Incorrect Password or Email</span>
            </div>
          )}
          
          {/* Remember Me */}
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="rememberMe"
              className="w-4 h-4 rounded border-[1.5px] border-border accent-primary cursor-pointer"
            />
            <label
              htmlFor="rememberMe"
              className="text-[12px] text-muted cursor-pointer select-none"
            >
              Remember Me
            </label>
          </div>
          {/* Sign in button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold border-none cursor-pointer shadow-[0_4px_18px_rgba(13,148,136,0.38)] transition-colors disabled:opacity-75 disabled:cursor-not-allowed"
          >
            {loading ? "Logging in…" : "Log In"}
          </button>
        </form>
        {/*form closes*/}
        {/* Spacer that push bottom part down and makes card taller */}
        <div className="flex-1 min-h-[48px]" />
        {/* Divider */}
        <div className="border-t border-border mb-5" />
        {/* Sign up link */}
        <p className="text-center text-[12px] text-muted">
          New to cukai.ai?{" "}
          <NavLink
            to="/getstarted"
            className="text-[#0F172A] font-semibold underline underline-offset-2 hover:text-primary transition-colors"
          >
            Sign Up.
          </NavLink>
        </p>
      </div>
    </div>
  );
}