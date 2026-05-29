import cukaiLogo from '../assets/cukai-logo.jpg'; // ← fix: was './assets/...'

function MainHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-100 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2.5">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-9 w-9 shrink-0"/>
          <span className="text-xl font-bold tracking-tight text-[#0F172A] select-none">
            cukai
            <span className="text-[#10B981]">.</span>
            <span className="font-light text-[#64748B]">ai</span>
          </span>
        </a>
        <a href="/auth" className="rounded-lg border-[1.5px] border-[#0F172A] px-[18px] py-2 text-sm font-medium text-[#0F172A] transition-colors duration-150 hover:bg-[#0F172A] hover:text-white">
          Log in / Sign up
        </a>
      </div>
    </header>
  );
}

export default MainHeader;