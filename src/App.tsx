import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router'
import { DevMode } from '@/dev/DevMode'
import { AppShell } from '@/app/AppShell'
import { RedirectIfAuthed, RequireAuth, RequireOnboarded } from '@/app/Guards'
import { NotFound } from '@/app/NotFound'
import { Splash } from '@/features/auth/Splash'

// Route-level code splitting: each screen loads on demand.
const L = <T extends Record<string, unknown>>(f: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await f())[name] as ComponentType }))

const Welcome = L(() => import('@/features/auth/Welcome'), 'Welcome')
const SignIn = L(() => import('@/features/auth/SignIn'), 'SignIn')
const SignUp = L(() => import('@/features/auth/SignUp'), 'SignUp')
const ForgotPassword = L(() => import('@/features/auth/ForgotPassword'), 'ForgotPassword')
const ResetPassword = L(() => import('@/features/auth/ResetPassword'), 'ResetPassword')
const AuthCallback = L(() => import('@/features/auth/AuthCallback'), 'AuthCallback')
const CheckEmail = L(() => import('@/features/auth/CheckEmail'), 'CheckEmail')
const Onboarding = L(() => import('@/features/onboarding/Onboarding'), 'Onboarding')
const Home = L(() => import('@/features/home/Home'), 'Home')
const PlanPage = L(() => import('@/features/plan/PlanPage'), 'PlanPage')
const NewPlan = L(() => import('@/features/plan/NewPlan'), 'NewPlan')
const FirstPlan = L(() => import('@/features/plan/FirstPlan'), 'FirstPlan')
const PlannedMealPage = L(() => import('@/features/plan/PlannedMealPage'), 'PlannedMealPage')
const GroceryPage = L(() => import('@/features/grocery/GroceryPage'), 'GroceryPage')
const DiaryPage = L(() => import('@/features/diary/DiaryPage'), 'DiaryPage')
const AddFood = L(() => import('@/features/diary/AddFood'), 'AddFood')
const ScanPage = L(() => import('@/features/scanner/ScanPage'), 'ScanPage')
const Discover = L(() => import('@/features/discover/Discover'), 'Discover')
const Surprise = L(() => import('@/features/discover/Surprise'), 'Surprise')
const RecipeDetail = L(() => import('@/features/recipes/RecipeDetail'), 'RecipeDetail')
const ImageStudio = L(() => import('@/features/admin/ImageStudio'), 'ImageStudio')
const KitchenPage = L(() => import('@/features/kitchen/KitchenPage'), 'KitchenPage')
const BudgetPage = L(() => import('@/features/budget/BudgetPage'), 'BudgetPage')
const ProfilePage = L(() => import('@/features/profile/ProfilePage'), 'ProfilePage')
const PreferencesPage = L(() => import('@/features/profile/PreferencesPage'), 'PreferencesPage')
const GoalsPage = L(() => import('@/features/profile/GoalsPage'), 'GoalsPage')
const NotificationsPage = L(() => import('@/features/profile/NotificationsPage'), 'NotificationsPage')
const AccountPage = L(() => import('@/features/profile/AccountPage'), 'AccountPage')
const SettingsPage = L(() => import('@/features/profile/SettingsPage'), 'SettingsPage')
const SyncPage = L(() => import('@/features/profile/SyncPage'), 'SyncPage')
const HistoryPage = L(() => import('@/features/profile/HistoryPage'), 'HistoryPage')
const Privacy = L(() => import('@/features/legal/Legal'), 'Privacy')
const Terms = L(() => import('@/features/legal/Legal'), 'Terms')

const Bare = () => (
  <Suspense fallback={<Splash />}>
    <Outlet />
    <DevMode />
  </Suspense>
)

const router = createBrowserRouter([
  {
    element: <Bare />,
    children: [
      { path: '/welcome', element: <RedirectIfAuthed><Welcome /></RedirectIfAuthed> },
      { path: '/sign-in', element: <RedirectIfAuthed><SignIn /></RedirectIfAuthed> },
      { path: '/sign-up', element: <RedirectIfAuthed><SignUp /></RedirectIfAuthed> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/check-email', element: <CheckEmail /> },
      { path: '/auth/callback', element: <AuthCallback /> },
      { path: '/reset-password', element: <RequireAuth><ResetPassword /></RequireAuth> },
      { path: '/privacy', element: <Privacy /> },
      { path: '/terms', element: <Terms /> },
      { path: '/onboarding', element: <RequireAuth><Onboarding /></RequireAuth> },
      { path: '/plan/first', element: <RequireAuth><RequireOnboarded><FirstPlan /></RequireOnboarded></RequireAuth> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <RequireOnboarded>
          <AppShell />
        </RequireOnboarded>
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Home /> },
      { path: '/plan', element: <PlanPage /> },
      { path: '/plan/new', element: <NewPlan /> },
      { path: '/meal/:id', element: <PlannedMealPage /> },
      { path: '/grocery', element: <GroceryPage /> },
      { path: '/grocery/:listId', element: <GroceryPage /> },
      { path: '/diary', element: <DiaryPage /> },
      { path: '/diary/add', element: <AddFood /> },
      { path: '/diary/edit/:entryId', element: <AddFood /> },
      { path: '/scan', element: <ScanPage /> },
      { path: '/discover', element: <Discover /> },
      { path: '/surprise', element: <Surprise /> },
      { path: '/recipes/:slug', element: <RecipeDetail /> },
      { path: '/kitchen', element: <KitchenPage /> },
      { path: '/budget', element: <BudgetPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/profile/preferences', element: <PreferencesPage /> },
      { path: '/profile/goals', element: <GoalsPage /> },
      { path: '/profile/notifications', element: <NotificationsPage /> },
      { path: '/profile/account', element: <AccountPage /> },
      { path: '/profile/settings', element: <SettingsPage /> },
      { path: '/profile/sync', element: <SyncPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/admin/images', element: <ImageStudio /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
