import pino from 'pino'

/**
 * SchemaCompressor — reduces tool description length while preserving semantics.
 */
export class SchemaCompressor {
  constructor(private logger: pino.Logger) {}

  /**
   * Compress a tool description to save tokens.
   * Removes filler words, shortens sentences, keeps the action verb + object.
   */
  compress(description: string): string {
    let result = description

    // Remove common filler phrases
    const fillers = [
      /\bThis tool\b/gi,
      /\bUse this to\b/gi,
      /\bAllows you to\b/gi,
      /\bCan be used to\b/gi,
      /\bProvides the ability to\b/gi,
      /\bReturns the result of\b/gi,
      /\bWhen called,?\s*/gi,
      /\bPlease note that\b/gi,
      /\bIt is important to\b/gi,
      /\bfor example\b/gi,
      /\be\.g\.,?\s*/gi,
    ]

    for (const filler of fillers) {
      result = result.replace(filler, '')
    }

    // Remove double spaces
    result = result.replace(/\s{2,}/g, ' ').trim()

    // Cap at 200 chars
    if (result.length > 200) {
      result = result.substring(0, 197) + '...'
    }

    if (result.length < description.length) {
      this.logger.debug(
        { original: description.length, compressed: result.length, savings: description.length - result.length },
        'Description compressed'
      )
    }

    return result
  }

  /**
   * Estimate token count for a string.
   * Rough heuristic: 1 token ≈ 4 characters for English text.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}
