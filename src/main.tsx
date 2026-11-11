import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installPressSounds } from '@/lib/uiSound'
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
import { BootSplash } from '@/app/BootSplash'

const queryClient = makeQueryClient()
installPressSounds() // one listener for the whole app: unlocks audio on the first gesture, soft click on presses
// without a backend there is no session to wait for: drop the launch backdrop at once
if (!isSupabaseConfigured) document.getElementById('boot')?.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
    {isSupabaseConfigured ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BootSplash />
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
