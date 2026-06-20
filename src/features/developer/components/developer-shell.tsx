"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Activity, Building2, Code2, LogOut, RefreshCw, ShieldCheck } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/auth-context"
import { ROUTES } from "@/config/routes"
import { cn } from "@/lib/utils"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu"
import { Separator } from "@/components/ui/separator"

const links = [
  { href: "/developer", label: "مركز التحكم", icon: Activity },
  { href: "/developer#clients", label: "العملاء", icon: Building2 },
  { href: "/developer#platform", label: "المنصة", icon: Code2 },
]

export function DeveloperShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const auth = useAuth()

  useEffect(() => {
    if (!auth.loading && !auth.user) router.replace(ROUTES.login)
    else if (!auth.loading && auth.user && !auth.isDeveloper) router.replace(ROUTES.dashboard)
  }, [auth.isDeveloper, auth.loading, auth.user, router])

  if (auth.loading || !auth.user || !auth.isDeveloper) return <div className="min-h-dvh bg-slate-950" />

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1700px] items-center gap-3 px-4 sm:px-6">
          <Link href="/developer" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20">
              <ShieldCheck className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-black">Logixa Control Plane</span>
              <span className="block text-[10px] font-bold text-slate-400">منصة إدارة النظام</span>
            </span>
          </Link>

          <NavigationMenu className="mr-4 hidden lg:flex">
            <NavigationMenuList className="gap-1">
              {links.map(({ href, label, icon: Icon }) => (
                <NavigationMenuItem key={href}>
                  <Link href={href} legacyBehavior passHref>
                    <NavigationMenuLink
                      className={cn(
                        "flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black transition",
                        pathname === "/developer"
                          ? "bg-white/10 text-white"
                          : "text-slate-400 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className="size-4" /> {label}
                    </NavigationMenuLink>
                  </Link>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>

          <div className="mr-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => window.location.reload()}>
              <RefreshCw className="size-4" /> تحديث
            </Button>
            <Button variant="outline" size="sm" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={auth.signOut}>
              <LogOut className="size-4" /> خروج
            </Button>
          </div>
        </div>
      </header>
      <Separator className="bg-white/5" />
      <main>{children}</main>
    </div>
  )
}
