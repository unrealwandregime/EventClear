"use client";

import { useCallback, useState } from "react";
import type { TransactionStage } from "../lib/types";

const STORAGE_KEY = "eventclear.transactions.v1";

export function usePersistentTransactions() {
  const [stages, setStages] = useState<TransactionStage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "[]",
      ) as TransactionStage[];
    } catch {
      return [];
    }
  });

  const record = useCallback((stage: TransactionStage) => {
    setStages((current) => {
      const next = [
        stage,
        ...current.filter((item) => item.action !== stage.action),
      ].slice(0, 20);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { stages, record };
}
