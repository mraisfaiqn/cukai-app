import { NavLink } from "react-router-dom";

function UserNavigation() {
  const tabs = [
    { name: "Personal Profile", path: "/manageaccount/personal" },
    { name: "Profile & Entities", path: "/manageaccount/profile" },
    { name: "Manage Permissions", path: "/manageaccount/permissions" },
    { name: "Language & Display", path: "/manageaccount/display" },
  ];

  return (
    <nav className="flex items-center gap-2 border-b border-slate-100 pb-px">
      {tabs.map((tab) => (
        <NavLink
          key={tab.name}
          to={tab.path}
          className={({ isActive }) =>
            `relative px-4 py-2.5 text-sm font-medium transition-all duration-150 block select-none ${
              isActive
                ? "text-[#0D9488] font-semibold"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span>{tab.name}</span>
              {/* Active bottom border slider matching teammate design choices */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#10B981]" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
export default UserNavigation 