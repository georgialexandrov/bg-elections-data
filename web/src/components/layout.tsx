import { useEffect, useState } from "react";
import { Outlet, NavLink, useParams, useNavigate } from "react-router";
import { trackEvent } from "@/lib/analytics.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Election {
  id: number;
  name: string;
  date: string;
  type: string;
}

const NAV_ITEMS = [
  { label: "Резултати", path: "results" },
  { label: "Секции", path: "sections" },
  { label: "Таблица", path: "table" },
] as const;

const STANDALONE_NAV = [
  { label: "Системни", path: "/persistence" },
] as const;

const REPORT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdLB0n9twfFQyiD4mIpAX_fYc_-N5bUhfkKpVJa6_-Oxv5CAQ/viewform";

export default function Layout() {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const [elections, setElections] = useState<Election[]>([]);

  useEffect(() => {
    fetch("/api/elections")
      .then((res) => res.json())
      .then(setElections)
      .catch(() => {});
  }, []);

  // Redirect to latest election only from root path
  const isRootPath = window.location.pathname === "/";
  useEffect(() => {
    if (isRootPath && elections.length > 0) {
      navigate(`/${elections[0].id}/results`, { replace: true });
    }
  }, [isRootPath, elections, navigate]);

  return (
    <div className="flex h-screen w-full flex-col">
      {/* Navbar */}
      <nav className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-3 py-2 md:h-11 md:px-4 md:py-0">
        {/* App title — editorial serif */}
        <span className="font-display text-lg font-semibold tracking-tight text-foreground">
          Избори
        </span>

        {/* Thin vertical divider */}
        <span className="hidden h-4 w-px bg-border md:block" />

        {/* Election selector */}
        {elections.length > 0 && (
          <Select
            value={electionId ?? String(elections[0]?.id)}
            onValueChange={(val) => {
              const path = window.location.pathname;
              const viewMatch = path.match(/\/\d+\/(\w+)/);
              const view = viewMatch ? viewMatch[1] : "results";
              trackEvent("select_election", { election_id: val });
              navigate(`/${val}/${view}`);
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 max-w-[280px] border-0 bg-transparent text-xs font-medium shadow-none sm:max-w-[400px] md:max-w-[500px]">
              <SelectValue placeholder="Избери избори">
                {(() => {
                  const eid = electionId ?? String(elections[0]?.id);
                  const e = elections.find((el) => String(el.id) === eid);
                  return e ? e.name : eid;
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="min-w-[400px] max-w-[calc(100vw-2rem)]">
              {elections.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  <span className="truncate">{e.name}</span>
                  <span className="ml-1 shrink-0 text-muted-foreground">({e.date})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* All nav items together */}
        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          {(electionId || elections.length > 0) && NAV_ITEMS.map((item) => {
            const eid = electionId ?? String(elections[0]?.id);
            return (
              <NavLink
                key={item.path}
                to={`/${eid}/${item.path}`}
                className={({ isActive }) =>
                  `rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            );
          })}
          {STANDALONE_NAV.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Help actions — right side */}
        <div className="ml-auto flex items-center gap-1">
          <NavLink
            to="/help/coordinates"
            className={({ isActive }) =>
              `rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors ${
                isActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`
            }
          >
            Помогни
          </NavLink>
          <a
            href={`${REPORT_FORM_URL}?entry.1736983913=${encodeURIComponent(window.location.href)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[#ce463c] transition-colors hover:bg-[#ce463c10]"
          >
            Проблем?
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
