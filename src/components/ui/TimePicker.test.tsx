import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DISHTimePicker } from './TimePicker'

// jsdom has no layout: give elements a scrollTo that records the request
Element.prototype.scrollTo = function (this: Element, o?: ScrollToOptions | number) {
  if (typeof o === 'object' && o.top != null) (this as HTMLElement).scrollTop = o.top
} as Element['scrollTo']

describe('DISHTimePicker', () => {
  it('24-hour: keyboard moves hours and minutes and emits a 24-hour value', () => {
    const onChange = vi.fn()
    render(<DISHTimePicker value="23:55" onChange={onChange} format="24h" />)
    expect(screen.queryByRole('spinbutton', { name: 'AM or PM' })).toBeNull()
    const hour = screen.getByRole('spinbutton', { name: 'Hour' })
    expect(hour).toHaveAttribute('aria-valuetext', '23')
    fireEvent.keyDown(hour, { key: 'ArrowDown' }) // already the last hour: nothing happens
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(hour, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('00:55')
    const minute = screen.getByRole('spinbutton', { name: 'Minute' })
    fireEvent.keyDown(minute, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('23:50') // five-minute steps by default
  })
  it('12-hour: noon and midnight through the AM/PM wheel', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DISHTimePicker value="12:00" onChange={onChange} format="12h" />)
    expect(screen.getByRole('spinbutton', { name: 'Hour' })).toHaveAttribute('aria-valuetext', '12')
    const period = screen.getByRole('spinbutton', { name: 'AM or PM' })
    expect(period).toHaveAttribute('aria-valuetext', 'PM')
    fireEvent.keyDown(period, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('00:00') // 12 PM → 12 AM is midnight
    rerender(<DISHTimePicker value="00:00" onChange={onChange} format="12h" />)
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Hour' }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('11:00') // 11 AM
  })
  it('one-minute precision, and an existing off-step time is kept when reopened', () => {
    const onChange = vi.fn()
    render(<DISHTimePicker value="07:32" onChange={onChange} format="24h" />)
    expect(screen.getByRole('spinbutton', { name: 'Minute' })).toHaveAttribute('aria-valuetext', '32')
    const one = vi.fn()
    render(<DISHTimePicker value="07:59" onChange={one} format="24h" step={1} />)
    const minutes = screen.getAllByRole('spinbutton', { name: 'Minute' })[1]!
    fireEvent.keyDown(minutes, { key: 'ArrowUp' })
    expect(one).toHaveBeenLastCalledWith('07:58')
  })
})
