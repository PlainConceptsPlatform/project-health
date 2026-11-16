import { Fragment } from 'react'
import { externalTools, toolLink } from '../lib/tools'

/** One tool name: a link to its project when it is a known open-source tool, plain text otherwise. */
export function ToolName({ name }: { name: string }) {
  const url = toolLink(name)
  if (!url) return <>{name}</>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
      {name}
    </a>
  )
}

/**
 * The open-source tools behind a practice, each linked. A platform gate script or facet is shown
 * as the tools whose output it reads, never under its own name.
 */
export function ToolList({ tools }: { tools: string[] }) {
  const shown = externalTools(tools)
  if (shown.length === 0) return <>none found</>
  return (
    <>
      {shown.map((tool, i) => (
        <Fragment key={tool}>
          {i > 0 ? ', ' : null}
          <ToolName name={tool} />
        </Fragment>
      ))}
    </>
  )
}
