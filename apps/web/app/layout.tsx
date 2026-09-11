import type { Metadata } from "next";
import "./globals.css";
import { AccountProvider, type AtlasAccount } from "../components/account-provider";
import { owner } from "../lib/security";
import { db } from "../lib/db";
import { normalizeSettings } from "../lib/ai-routing";
export const metadata: Metadata = {
  title: "AgentSession Atlas",
  description: "내 코딩 에이전트 세션을 기록하고 분석합니다.",
};
const themeScript = `try{var t=localStorage.getItem('atlas-theme')||'dark';document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.lang=localStorage.getItem('atlas-language')||'ko'}catch(e){}`;
async function initialAccount(): Promise<AtlasAccount | null | undefined> {
  try {
    const id = await owner(undefined, true);
    const [user] =
      await db()`SELECT id,name,guest,settings,key_cipher IS NOT NULL AS has_key FROM atlas.users WHERE id=${id}`;
    return user
      ? {
          id: String(user.id),
          name: String(user.name),
          guest: Boolean(user.guest),
          has_key: Boolean(user.has_key),
          settings: normalizeSettings(user.settings) as AtlasAccount["settings"],
        }
      : null;
  } catch {
    // Keep the UI neutral until the client can check /api/me. Do not render a
    // signed-out state when server-side account lookup itself was unavailable.
    return undefined;
  }
}
export default async function Layout({ children }: { children: React.ReactNode }) {
  const account = await initialAccount();
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AccountProvider initialUser={account}>{children}</AccountProvider>
      </body>
    </html>
  );
}
