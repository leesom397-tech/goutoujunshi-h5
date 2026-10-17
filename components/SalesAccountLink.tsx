"use client";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

export function SalesAccountLink({ variant }: { variant: "footer" | "contact" }) {
  const [state, setState] = useState<"loading" | "out" | "in">("loading");
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", signal: controller.signal })
      .then(response => response.json() as Promise<{ loggedIn?: boolean }>)
      .then(async session => {
        if (controller.signal.aborted) return;
        if (!session.loggedIn) { setState("out"); return; }
        const credits = await fetch("/api/account/credits", { cache: "no-store", signal: controller.signal });
        if (!credits.ok) { setState("out"); return; }
        const value = await credits.json() as { account?: { balance?: number } };
        if (controller.signal.aborted) return;
        setBalance(typeof value.account?.balance === "number" ? value.account.balance : null);
        setState("in");
      })
      .catch(() => { if (!controller.signal.aborted) setState("out"); });
    return () => controller.abort();
  }, []);
  if (variant === "footer") {
    if (state === "loading") return <a href="/account#balance">我的账户</a>;
    if (state === "in") return <a href="/account#balance">账户余额 {balance ?? "—"} 积分</a>;
    return <a href="/login?return_to=%2Fsales">登录</a>;
  }
  if (state === "loading") return <a className="sales-primary" href="/account#balance">我的账户 <ArrowRight size={16}/></a>;
  if (state === "in") return <a className="sales-primary" href="/account#balance">账户余额 {balance ?? "—"} 积分 <ArrowRight size={16}/></a>;
  return <a className="sales-primary" href="/login?return_to=%2Faccount%23balance">登录后查看账户 <ArrowRight size={16}/></a>;
}
