/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import SeedImport from '../SeedImport'

test('renders 12 inputs', () => {
  render(<SeedImport onImport={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  expect(inputs).toHaveLength(12)
})

test('Restore button is disabled when inputs are empty', () => {
  render(<SeedImport onImport={jest.fn()} />)
  expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled()
})

test('paste of 12 valid BIP39 words fills all inputs', async () => {
  render(<SeedImport onImport={jest.fn()} />)
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const inputs = screen.getAllByRole('textbox')
  fireEvent.paste(inputs[0], {
    clipboardData: { getData: () => phrase },
  })
  await waitFor(() => {
    const updatedInputs = screen.getAllByRole('textbox')
    expect((updatedInputs[0] as HTMLInputElement).value).toBe('abandon')
    expect((updatedInputs[11] as HTMLInputElement).value).toBe('about')
  })
})

test('paste of wrong word count shows error', async () => {
  render(<SeedImport onImport={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  fireEvent.paste(inputs[0], {
    clipboardData: { getData: () => 'only three words here' },
  })
  await waitFor(() => {
    expect(screen.getByText(/paste must be exactly 12 words/i)).toBeInTheDocument()
  })
})

test('calls onImport with words when Restore clicked', async () => {
  const onImport = jest.fn().mockResolvedValue(undefined)
  render(<SeedImport onImport={onImport} />)
  const inputs = screen.getAllByRole('textbox')
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  fireEvent.paste(inputs[0], { clipboardData: { getData: () => phrase } })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /restore/i })).not.toBeDisabled()
  })
  fireEvent.click(screen.getByRole('button', { name: /restore/i }))
  await waitFor(() => {
    expect(onImport).toHaveBeenCalledWith(phrase.split(' '))
  })
})
