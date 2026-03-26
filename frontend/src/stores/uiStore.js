/**
 * Zustand store for transient UI and session state.
 *
 * Replaces prop-drilled useState hooks that were scattered across App.jsx.
 * Components import selectors directly instead of receiving props.
 */
import { create } from 'zustand';

export const useUIStore = create((set) => ({
  // Sidebar
  sidebarOpen: window.innerWidth > 768,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Mode
  mode: 'council',
  setMode: (mode) => set({ mode }),

  // Arena
  arenaRoundCount: 3,
  setArenaRoundCount: (count) => set({ arenaRoundCount: count }),

  // Web search
  useWebSearch: false,
  toggleWebSearch: () => set((s) => ({ useWebSearch: !s.useWebSearch })),

  // Fork context
  pendingForkContext: null,
  setPendingForkContext: (ctx) => set({ pendingForkContext: ctx }),

  // Auth
  authExpired: false,
  setAuthExpired: (expired) => set({ authExpired: expired }),

  // Current conversation
  currentConversationId: null,
  setCurrentConversationId: (id) => set({ currentConversationId: id }),
}));
