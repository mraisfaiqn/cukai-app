import {NavLink} from 'react-router-dom';
import cukaiLogo from '../assets/cukai-logo.png';

function MainHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-100 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 shrink-0" />
          <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
            cukai
            <span className="text-[#10B981]">.</span>
            <span className="font-light text-[#64748B]">ai</span>
          </span>
        </a>
        {/* Login and Get Started */}
        <div className="flex items-center gap-2">
          <NavLink to="/login" className={({ isActive }) => `rounded-lg border-[1.5px] px-[18px] py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-[#0F172A] text-[#0F172A] hover:bg-[#0F172A] hover:text-white'}`}>
            Login
          </NavLink>
          <NavLink to="/getstarted" className={({ isActive }) => `rounded-lg border-[1.5px] px-[18px] py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'border-[#0D9488] bg-[#0D9488] text-white' : 'border-[#10B981] bg-[#10B981] text-white hover:bg-[#0D9488] hover:border-[#0D9488]'}`}>
            Get Started
          </NavLink>
        </div>

      </div>
    </header>
  );
}

export default MainHeader;