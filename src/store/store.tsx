// ===== 存储层：React Context 装配（单一数据源 + localStorage 持久化）=====
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { State } from "../domain/types";
import { seedState } from "../data/seed";
import { reducer, type Action } from "./reducer";

const STORAGE_KEY = "hxyfront-62013-dispatch-v1";

export function init(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    // 忽略损坏的本地数据
  }
  return { ...seedState };
}

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  reset: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时静默降级为内存态
    }
  }, [state]);

  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      reset: () => dispatch({ type: "RESET" }),
    }),
    [state],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 StoreProvider 内使用");
  return ctx;
}
