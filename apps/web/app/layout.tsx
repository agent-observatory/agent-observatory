import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AgentSession Atlas",
  description: "내 코딩 에이전트 세션을 기록하고 분석합니다.",
};
const themeScript = `try{var t=localStorage.getItem('atlas-theme')||'dark';document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.lang=localStorage.getItem('atlas-language')||'ko'}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
