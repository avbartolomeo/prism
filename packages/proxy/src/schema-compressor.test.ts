import { describe, it, expect } from 'vitest'
import { SchemaCompressor } from './schema-compressor'
import pino from 'pino'

const logger = pino({ level: 'silent' })

describe('SchemaCompressor', () => {
  const compressor = new SchemaCompressor(logger)

  it('should remove "This tool" filler', () => {
    const result = compressor.compress('This tool echoes back the input message.')
    expect(result).not.toContain('This tool')
    expect(result).toContain('echoes back')
  })

  it('should remove "Provides the ability to" filler', () => {
    const result = compressor.compress('Provides the ability to add two numbers together.')
    expect(result).not.toContain('Provides the ability to')
    expect(result).toContain('add two numbers')
  })

  it('should remove "Can be used to" filler', () => {
    const result = compressor.compress('Can be used to generate a greeting for a person.')
    expect(result).not.toContain('Can be used to')
    expect(result).toContain('generate a greeting')
  })

  it('should cap at 200 characters', () => {
    const long = 'A'.repeat(300)
    const result = compressor.compress(long)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result.endsWith('...')).toBe(true)
  })

  it('should remove double spaces', () => {
    const result = compressor.compress('This tool  does  something  great.')
    expect(result).not.toContain('  ')
  })

  it('should estimate tokens', () => {
    const tokens = compressor.estimateTokens('hello world') // 11 chars
    expect(tokens).toBe(3) // ceil(11/4)
  })

  it('should return unchanged for short clean descriptions', () => {
    const desc = 'Read a file from disk.'
    const result = compressor.compress(desc)
    expect(result).toBe(desc)
  })
})
