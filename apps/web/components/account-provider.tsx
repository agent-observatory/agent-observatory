"use client";

import { createContext, useContext, useState } from "react";

export type AtlasAccount = {
  id: string;
  name: string;
  guest: boolean;
  settings: {
    language: "ko" | "en";
    timezone: string;
    theme: "dark" | "light" | "system";
    masking: boolean;
    provider: "free" | "openrouter" | "custom";
    endpoint: string;
    model: string;
  };
  has_key: boolean;
};

type AccountState = {
  user: AtlasAccount | null;
  known: boolean;
  setAccount: (user: AtlasAccount | null) => void;
};

const AccountContext = createContext<AccountState | null>(null);

export function AccountProvider({
  initialUser,
  children,
}: {
  // undefined means the server could not establish account state. Consumers
  // keep account-only controls in a neutral loading state until /api/me does.
  initialUser: AtlasAccount | null | undefined;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AtlasAccount | null>(initialUser || null);
  const [known, setKnown] = useState(initialUser !== undefined);
  return (
    <AccountContext.Provider
      value={{
        user,
        known,
        setAccount: (nextUser) => {
          setUser(nextUser);
          setKnown(true);
        },
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAtlasAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("Atlas account provider is missing");
  return value;
}
