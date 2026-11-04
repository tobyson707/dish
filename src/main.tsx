import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './styles/index.css'
import { App } from './App'
import { makeQueryClient } from '@/lib/queryClient'
import { isSupabaseConfigured } from '@/lib/env'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { SetupRequired } from '@/app/SetupRequired'
import { UpdatePrompt } from '@/app/UpdatePrompt'
import { applyStoredTheme } from '@/features/profile/ThemeSwitch'

applyStoredTheme()

const queryClient = makeQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSupabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <App />
            <UpdatePrompt />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    ) : (
      <SetupRequired />
    )}
  </StrictMode>,
)
