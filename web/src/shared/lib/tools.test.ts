import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolList } from '../ui/tools'
import { PLATFORM_GATES, TOOL_LINKS, externalTools, toolLink } from './tools'

/**
 * The Engineering tab names the tools behind each practice. These pin that a known open-source
 * tool links to its project, that anything else stays plain text rather than a guessed link, and
 * that the platform's own gates are shown as the external tools they read.
 */

const render = (tools: string[]) => renderToStaticMarkup(createElement(ToolList, { tools }))

describe('tool links', () => {
  it('links a known tool to its project in a new tab, and leaves an unknown one as text', () => {
    const html = render(['Trivy', 'in-house-scanner'])
    expect(html).toContain(
      '<a href="https://github.com/aquasecurity/trivy" target="_blank" rel="noreferrer"',
    )
    expect(html).toContain('in-house-scanner')
    expect(html).not.toContain('href="in-house-scanner"')
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(toolLink('in-house-scanner')).toBeNull()
    // A prototype key is not a tool.
    expect(toolLink('constructor')).toBeNull()
  })

  it('shows the complexity gate as the open-source tools it reads, not under its own name', () => {
    const html = render(['check-complexity', 'complexity gate'])
    expect(html).not.toContain('check-complexity')
    expect(html).not.toContain('complexity gate')
    for (const tool of ['coverlet', 'ReportGenerator', 'Vitest', 'Istanbul', 'ESLint']) {
      expect(html).toContain(`>${tool}</a>`)
    }
    // Listed once each, even when two names of the same gate were detected.
    expect(externalTools(['check-complexity', 'complexity gate'])).toHaveLength(5)
    expect(externalTools(['Stryker', 'mutation facet'])).toEqual(['Stryker'])
  })

  it('maps every platform gate onto tools that have a link', () => {
    for (const tools of Object.values(PLATFORM_GATES)) {
      for (const tool of tools) expect(TOOL_LINKS[tool], tool).toMatch(/^https:\/\//)
    }
  })
})
