import type { McpTool } from '@prism/types'
import pino from 'pino'

/**
 * ContextFilter — selects which tools to include based on token budget
 * and relevance to the current context.
 */
export class ContextFilter {
  constructor(
    private maxTokenBudget: number,
    private logger: pino.Logger
  ) {}

  /**
   * Select tools that fit within the token budget.
   * If context is provided, prioritize tools whose names/descriptions match.
   */
  select(tools: McpTool[], context?: string): McpTool[] {
    // Score each tool by relevance
    const scored = tools.map(tool => ({
      tool,
      score: context ? this.scoreRelevance(tool, context) : 0,
      tokens: tool.tokenCount ?? this.estimateTokens(tool),
    }))

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    // Greedily select tools within budget
    const selected: McpTool[] = []
    let usedTokens = 0

    for (const { tool, tokens } of scored) {
      if (usedTokens + tokens > this.maxTokenBudget) {
        this.logger.debug(
          { tool: tool.name, tokens, budget: this.maxTokenBudget, used: usedTokens },
          'Tool excluded — over budget'
        )
        continue
      }
      selected.push(tool)
      usedTokens += tokens
    }

    this.logger.info(
      { total: tools.length, selected: selected.length, tokensUsed: usedTokens, budget: this.maxTokenBudget },
      'Context filter applied'
    )

    return selected
  }

  /**
   * Score how relevant a tool is to the current context.
   * Higher score = more likely to be included.
   */
  private scoreRelevance(tool: McpTool, context: string): number {
    const ctx = context.toLowerCase()
    let score = 0

    // Name match
    if (ctx.includes(tool.name.toLowerCase())) score += 10

    // Server name match
    if (ctx.includes(tool.serverName.toLowerCase())) score += 5

    // Description keyword match
    const desc = (tool.compressedDescription ?? tool.description).toLowerCase()
    const words = ctx.split(/\s+/).filter(w => w.length > 3)
    for (const word of words) {
      if (desc.includes(word)) score += 2
    }

    return score
  }

  private estimateTokens(tool: McpTool): number {
    // Rough estimate: 1 token ≈ 4 chars
    const text = tool.name + ' ' + (tool.compressedDescription ?? tool.description) +
      ' ' + JSON.stringify(tool.inputSchema)
    return Math.ceil(text.length / 4)
  }
}
