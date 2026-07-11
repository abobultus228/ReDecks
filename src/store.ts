import { create } from 'zustand';
import { Preferences } from '@capacitor/preferences';
import type { Collection, DeckType, RunConfig, SavedSettings, ManualChoicePayload } from './types';

interface AppState {
  // Auth
  token: string;
  userId: string;
  isPremium: boolean;
  setToken: (token: string) => void;
  setUserId: (id: string) => void;
  setIsPremium: (val: boolean) => void;

  // Навигация: открыть обмен с этим пользователем (транзиентно, не персистится)
  exchangeTargetUserId: number | null;
  setExchangeTargetUserId: (id: number | null) => void;

  // Навигация: открыть/создать чат с этим пользователем (транзиентно)
  chatTargetUserId: number | null;
  setChatTargetUserId: (id: number | null) => void;

  // Notifications
  notificationsEnabled: boolean;
  chatNotificationsEnabled: boolean;
  exchangeNotificationsEnabled: boolean;
  vibrationEnabled: boolean;
  mutedRoomIds: number[];
  onboardingDone: boolean;
  setNotificationsEnabled: (v: boolean) => void;
  setChatNotificationsEnabled: (v: boolean) => void;
  setExchangeNotificationsEnabled: (v: boolean) => void;
  setVibrationEnabled: (v: boolean) => void;
  setOnboardingDone: (v: boolean) => void;
  toggleMutedRoom: (roomId: number) => void;

  // Data
  collections: Collection[];
  availableDecks: DeckType[];
  setCollections: (c: Collection[]) => void;
  setAvailableDecks: (d: DeckType[]) => void;

  // Selection
  selectedCollectionId: string | number | null;
  selectedDeckId: number | null;
  openCount: number;
  priorityOwnedRule: 1 | 2 | 3;
  sameOrPriorityRule: 1 | 2;
  noPriorityRule: 1 | 2;
  setSelectedCollectionId: (id: string | number | null) => void;
  setSelectedDeckId: (id: number | null) => void;
  setOpenCount: (n: number) => void;
  setPriorityOwnedRule: (r: 1 | 2 | 3) => void;
  setSameOrPriorityRule: (r: 1 | 2) => void;
  setNoPriorityRule: (r: 1 | 2) => void;

  // Process
  logs: string[];
  isRunning: boolean;
  stopRequested: boolean;
  manualChoicePayload: ManualChoicePayload | null;
  addLog: (text: string) => void;
  clearLogs: () => void;
  setIsRunning: (val: boolean) => void;
  requestStop: () => void;
  resetStop: () => void;
  setManualChoicePayload: (p: ManualChoicePayload | null) => void;

  // Persistence
  saveSettings: () => Promise<void>;
  loadSettings: () => Promise<void>;

  // Derived
  buildConfig: () => RunConfig | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  token: '',
  userId: '',
  isPremium: false,
  setToken: (token) => set({ token }),
  setUserId: (userId) => set({ userId }),
  setIsPremium: (isPremium) => set({ isPremium }),

  exchangeTargetUserId: null,
  setExchangeTargetUserId: (exchangeTargetUserId) => set({ exchangeTargetUserId }),

  chatTargetUserId: null,
  setChatTargetUserId: (chatTargetUserId) => set({ chatTargetUserId }),

  notificationsEnabled: true,
  chatNotificationsEnabled: true,
  exchangeNotificationsEnabled: true,
  vibrationEnabled: true,
  mutedRoomIds: [],
  onboardingDone: false,
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
  setChatNotificationsEnabled: (chatNotificationsEnabled) => set({ chatNotificationsEnabled }),
  setExchangeNotificationsEnabled: (exchangeNotificationsEnabled) => set({ exchangeNotificationsEnabled }),
  setVibrationEnabled: (vibrationEnabled) => set({ vibrationEnabled }),
  setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
  toggleMutedRoom: (roomId) => set((s) => ({
    mutedRoomIds: s.mutedRoomIds.includes(roomId)
      ? s.mutedRoomIds.filter((id) => id !== roomId)
      : [...s.mutedRoomIds, roomId],
  })),

  collections: [],
  availableDecks: [],
  setCollections: (collections) => set({ collections }),
  setAvailableDecks: (availableDecks) => set({ availableDecks }),

  selectedCollectionId: null,
  selectedDeckId: null,
  openCount: 1,
  priorityOwnedRule: 1,
  sameOrPriorityRule: 1,
  noPriorityRule: 1,
  setSelectedCollectionId: (selectedCollectionId) => set({ selectedCollectionId }),
  setSelectedDeckId: (selectedDeckId) => set({ selectedDeckId }),
  setOpenCount: (openCount) => set({ openCount }),
  setPriorityOwnedRule: (priorityOwnedRule) => set({ priorityOwnedRule }),
  setSameOrPriorityRule: (sameOrPriorityRule) => set({ sameOrPriorityRule }),
  setNoPriorityRule: (noPriorityRule) => set({ noPriorityRule }),

  logs: [],
  isRunning: false,
  stopRequested: false,
  manualChoicePayload: null,
  addLog: (text) => set((s) => ({ logs: [...s.logs, text] })),
  clearLogs: () => set({ logs: [] }),
  setIsRunning: (isRunning) => set({ isRunning }),
  requestStop: () => set({ stopRequested: true }),
  resetStop: () => set({ stopRequested: false }),
  setManualChoicePayload: (manualChoicePayload) => set({ manualChoicePayload }),

  saveSettings: async () => {
    const s = get();
    const data: SavedSettings = {
      token: s.token,
      userId: s.userId,
      isPremium: s.isPremium,
      deckId: s.selectedDeckId ? String(s.selectedDeckId) : '',
      openCount: s.openCount,
      priorityOwnedRule: s.priorityOwnedRule,
      sameOrPriorityRule: s.sameOrPriorityRule,
      noPriorityRule: s.noPriorityRule,
      collectionId: s.selectedCollectionId,
      notificationsEnabled: s.notificationsEnabled,
      chatNotificationsEnabled: s.chatNotificationsEnabled,
      exchangeNotificationsEnabled: s.exchangeNotificationsEnabled,
      vibrationEnabled: s.vibrationEnabled,
      mutedRoomIds: s.mutedRoomIds,
      onboardingDone: s.onboardingDone,
    };
    await Preferences.set({ key: 'settings', value: JSON.stringify(data) });
  },

  loadSettings: async () => {
    const result = await Preferences.get({ key: 'settings' });
    if (!result.value) return;
    try {
      const data: SavedSettings = JSON.parse(result.value);
      set({
        token: data.token ?? '',
        userId: data.userId ?? '',
        isPremium: data.isPremium ?? false,
        openCount: data.openCount ?? 1,
        priorityOwnedRule: ([1, 2, 3].includes(data.priorityOwnedRule) ? data.priorityOwnedRule : 1) as 1 | 2 | 3,
        sameOrPriorityRule: (data.sameOrPriorityRule as 1 | 2) ?? 1,
        noPriorityRule: (data.noPriorityRule as 1 | 2) ?? 1,
        selectedCollectionId: data.collectionId ?? null,
        notificationsEnabled: data.notificationsEnabled ?? true,
        chatNotificationsEnabled: data.chatNotificationsEnabled ?? true,
        exchangeNotificationsEnabled: data.exchangeNotificationsEnabled ?? true,
        vibrationEnabled: data.vibrationEnabled ?? true,
        mutedRoomIds: Array.isArray(data.mutedRoomIds) ? data.mutedRoomIds : [],
        onboardingDone: data.onboardingDone ?? false,
      });
    } catch {
      // ignore
    }
  },

  buildConfig: (): RunConfig | null => {
    const s = get();
    const token = s.token.trim();
    const userId = parseInt(s.userId.trim(), 10);
    if (!token || isNaN(userId)) return null;

    const collection = s.collections.find(
      (c) => String(c.id) === String(s.selectedCollectionId)
    );
    if (!collection) return null;

    const deckId = s.selectedDeckId;
    if (deckId == null) return null;

    return {
      token,
      userId,
      collection,
      targetDeckId: deckId,
      openCount: s.openCount,
      priorityOwnedRule: s.priorityOwnedRule,
      sameOrPriorityRule: s.sameOrPriorityRule,
      noPriorityRule: s.noPriorityRule,
      isPremium: s.isPremium,
    };
  },
}));
