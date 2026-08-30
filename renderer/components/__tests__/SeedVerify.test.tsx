/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import SeedVerify from '../SeedVerify'

const WORDS = [
  'abandon','ability','able','about','above','absent',
  'absorb','abstract','absurd','abuse','access','accident',
]

test('renders 3 word inputs', () => {
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  expect(inputs).toHaveLength(3)
})

test('Continue button is disabled initially', () => {
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={jest.fn()} />)
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
})

test('Back link calls onBack', () => {
  const onBack = jest.fn()
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={onBack} />)
  fireEvent.click(screen.getByText(/back to words/i))
  expect(onBack).toHaveBeenCalledTimes(1)
})

test('correct answers enable Continue and call onVerified', () => {
  const onVerified = jest.fn()
  render(<SeedVerify words={WORDS} onVerified={onVerified} onBack={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  const labels = screen.getAllByText(/word #\d+/i)

  // Extract which word indices are asked (from label text "Word #N")
  labels.forEach((label, i) => {
    const match = label.textContent?.match(/Word #(\d+)/i)
    if (match) {
      const idx = parseInt(match[1]) - 1
      fireEvent.change(inputs[i], { target: { value: WORDS[idx] } })
    }
  })

  expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  expect(onVerified).toHaveBeenCalledTimes(1)
})
