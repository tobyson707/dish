import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

const logDiary = vi.fn().mockResolvedValue('id')
const scan = vi.fn().mockResolvedValue({
  items: [{ name: 'Jollof rice', matched_food_item_id: null, portion_description: 'about 1 plate', servings_estimate: 1, calories: 650, protein_g: 18, carbs_g: 95, fat_g: 20, confidence: 'medium', possible_ingredients: ['rice', 'tomato'] }],
  overall_confidence: 'medium',
  uncertainty_notes: ['Oil quantity cannot be seen in a photo.'],
  needs_user_input: false,
  model: 'test-model',
})
vi.mock('@/data/ai', () => ({
  useAIStatus: () => ({ data: { ai_configured: true, vision_configured: true }, isPending: false }),
  useScanFood: () => ({ mutateAsync: scan }),
}))
vi.mock('@/data/diary', () => ({ useLogDiary: () => ({ mutateAsync: logDiary }) }))
vi.mock('@/features/auth/AuthProvider', () => ({ useUserId: () => '00000000-0000-4000-8000-000000000001' }))
vi.mock('@/hooks/useToday', () => ({ useToday: () => '2026-11-04' }))
vi.mock('@/offline/useSync', () => ({ useSyncState: () => ({ online: true }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), show: vi.fn() }) }))
vi.mock('@/platform/camera', () => ({ prepareImage: vi.fn().mockResolvedValue({ blob: new Blob(['x']), previewUrl: 'blob:x', width: 10, height: 10 }) }))
const upload = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase', () => ({ SCAN_BUCKET: 'food-scans', supabase: { storage: { from: () => ({ upload, remove: vi.fn().mockResolvedValue({}) }) } } }))

import { ScanPage } from './ScanPage'

describe('food scanner', () => {
  it('shows editable estimates and saves nothing until the user confirms', async () => {
    const user = userEvent.setup()
    const { container } = render(<MemoryRouter><ScanPage /></MemoryRouter>)
    const input = container.querySelector('input[type=file]:not([capture])') as HTMLInputElement
    await user.upload(input, new File(['img'], 'plate.jpg', { type: 'image/jpeg' }))
    await user.click(await screen.findByRole('button', { name: /Analyse photo/ }))
    await screen.findByText("Here's our best guess")
    expect(upload).toHaveBeenCalledOnce()
    expect(scan).toHaveBeenCalledOnce()
    expect(screen.getByText(/Oil quantity cannot be seen/)).toBeInTheDocument()
    expect(logDiary).not.toHaveBeenCalled()

    // user corrects the calories → provenance becomes "user"
    const cal = screen.getByLabelText(/Calories \/ serving/)
    await user.clear(cal)
    await user.type(cal, '700')
    await user.click(screen.getByRole('button', { name: /Save to diary/ }))
    await waitFor(() => expect(logDiary).toHaveBeenCalledOnce())
    expect(logDiary.mock.calls[0]![0]).toMatchObject({ source: 'scan', name: 'Jollof rice', nutrition: { calories: 700, source: 'user', is_estimate: true } })
  })
})
