/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SeedGrid from '../SeedGrid'

const WORDS = [
  'abandon','ability','able','about','above','absent',
  'absorb','abstract','absurd','abuse','access','accident',
]

test('renders 12 numbered word cells', () => {
  render(<SeedGrid words={WORDS} />)
  // Number labels 1–12 should be visible
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
})

test('words are hidden by default', () => {
  render(<SeedGrid words={WORDS} />)
  expect(screen.queryByText('abandon')).not.toBeInTheDocument()
  expect(screen.getByText('Reveal seed phrase')).toBeInTheDocument()
})

test('toggle reveals all words', () => {
  render(<SeedGrid words={WORDS} />)
  fireEvent.click(screen.getByText('Reveal seed phrase'))
  expect(screen.getByText('abandon')).toBeInTheDocument()
  expect(screen.getByText('accident')).toBeInTheDocument()
  expect(screen.getByText('Hide seed phrase')).toBeInTheDocument()
})

test('toggle twice hides words again', () => {
  render(<SeedGrid words={WORDS} />)
  fireEvent.click(screen.getByText('Reveal seed phrase'))
  fireEvent.click(screen.getByText('Hide seed phrase'))
  expect(screen.queryByText('abandon')).not.toBeInTheDocument()
})
