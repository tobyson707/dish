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
import { ThemeProvider } from '@/theme/ThemeProvider'
import { ThemeSync } from '@/theme/ThemeSync'

const queryClient = makeQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
    {isSupabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeSync />
          <ToastProvider>
            <App />
            <UpdatePrompt />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    ) : (
      <SetupRequired />
    )}
    </ThemeProvider>
  </StrictMode>,
)
