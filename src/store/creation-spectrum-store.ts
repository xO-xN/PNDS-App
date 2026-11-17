import { create } from 'zustand'
import type {
  CreationAudioAnalyzerEvent,
  CreationAudioStats,
} from '@/lib/tauri-bindings'

export const useCreationSpectrumStore = create<{
  generation: string | null
  frame: CreationAudioAnalyzerEvent | null
  stats: CreationAudioStats | null
}>(() => ({ generation: null, frame: null, stats: null }))
